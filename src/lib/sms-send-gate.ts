import { canonicalDeadReason } from '@/lib/lead-outcomes'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { handleOptOut, isSmsOptOutMessage } from '@/lib/sms-opt-out'
import { isWithinRecipientSmsHours } from '@/lib/sms-quiet-hours'
import { supabase } from '@/lib/supabase-lazy'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'

/**
 * Fail-closed gate for automatic seller/buyer SMS (A2P templates and auto-text).
 * A send is refused when any of these is true:
 * - sms_opt_outs has an active opt-out for the destination phone
 * - the phone's crm_contact_methods.sms_consent_status is opted_out
 * - a lead with that same phone is dead with dead_reason dnc_refused (DND)
 * - consent is not a newer explicit opt-in, and a prior inbound SMS matches
 *   the opt-out matcher (the INC-2026-09-22-001 hole: natural language never
 *   wrote sms_opt_outs, so isOptedOut() alone allowed the send)
 * Lookup failures throw. Callers must not send when this throws.
 */

export type AutomatedSmsBlockReason =
  | 'opted_out'
  | 'contact_opted_out'
  | 'dnd'
  | 'inbound_opt_out'
  | 'company_number'

const INBOUND_DIRECTIONS = new Set(['received', 'inbound', 'in', 'incoming'])
const INBOUND_ACTIVITY_TYPES = ['sms', 'sms_received', 'sms_inbound']
const RECENT_SMS_LIMIT = 50

type OptOutRow = {
  is_opted_out: boolean | null
  opted_in_at: string | null
}

type ContactConsentRow = {
  sms_consent_status: string | null
  consent_observed_at: string | null
}

type LeadSuppressionRow = {
  id: string
  phone: string | null
  dead_reason: string | null
}

type SmsActivityRow = {
  description: string | null
  created_at: string | null
  activity_type: string | null
  metadata: Record<string, unknown> | null
}

function suppressionError(): Error {
  return new Error('SMS suppression status could not be verified')
}

function phoneLookupVariants(raw: string): string[] {
  const variants = new Set<string>()
  if (raw.trim()) variants.add(raw.trim())
  const canonical = normalizePhoneToE164(raw)
  if (!canonical) return [...variants]
  const national = canonical.slice(2)
  const area = national.slice(0, 3)
  const exchange = national.slice(3, 6)
  const line = national.slice(6)
  variants.add(canonical)
  variants.add(national)
  variants.add(`(${area}) ${exchange}-${line}`)
  variants.add(`${area}-${exchange}-${line}`)
  return [...variants]
}

function samePhone(candidate: string | null | undefined, phone: string): boolean {
  const left = normalizePhoneToE164(candidate)
  const right = normalizePhoneToE164(phone)
  if (left && right) return left === right
  return (candidate || '').trim() === phone.trim()
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const parsed = values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => !Number.isNaN(entry.time))
  if (!parsed.length) return null
  parsed.sort((a, b) => b.time - a.time)
  return parsed[0].value
}

function isInboundSms(row: SmsActivityRow): boolean {
  if (row.activity_type === 'sms_received' || row.activity_type === 'sms_inbound') return true
  const direction = typeof row.metadata?.direction === 'string' ? row.metadata.direction.toLowerCase() : ''
  return INBOUND_DIRECTIONS.has(direction)
}

async function loadOptOut(phone: string): Promise<OptOutRow | null> {
  const { data, error } = await supabase
    .from('sms_opt_outs')
    .select('is_opted_out, opted_in_at')
    .eq('phone', phone)
    .maybeSingle()
  if (error) throw suppressionError()
  return data
}

async function loadContactConsent(phone: string): Promise<ContactConsentRow | null> {
  const { data, error } = await supabase
    .from('crm_contact_methods')
    .select('sms_consent_status, consent_observed_at')
    .eq('method_type', 'phone')
    .eq('normalized_value', phone)
    .limit(5)
  if (error) throw suppressionError()
  const rows = (data || []) as ContactConsentRow[]
  return rows.find((row) => row.sms_consent_status === 'opted_out') || rows[0] || null
}

async function loadLeadSuppression(phone: string, leadId?: string | null): Promise<{ id: string | null; dnd: boolean }> {
  const variants = phoneLookupVariants(phone)
  const matched: LeadSuppressionRow[] = []
  if (variants.length > 0) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, phone, dead_reason')
      .in('phone', variants)
      .limit(20)
    if (error) throw suppressionError()
    matched.push(...((data || []) as LeadSuppressionRow[]).filter((row) => samePhone(row.phone, phone)))
  }

  if (leadId && !matched.some((row) => row.id === leadId)) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, phone, dead_reason')
      .eq('id', leadId)
      .maybeSingle()
    if (error) throw suppressionError()
    if (data && samePhone(data.phone, phone)) matched.push(data as LeadSuppressionRow)
  }

  const preferred = matched.find((row) => row.id === leadId) || matched[0] || null
  return {
    id: preferred?.id ?? null,
    dnd: matched.some((row) => canonicalDeadReason(row.dead_reason) === 'dnc_refused'),
  }
}

async function loadRecentSms(phone: string, leadId: string | null): Promise<SmsActivityRow[]> {
  const query = supabase
    .from('lead_activities')
    .select('description, created_at, metadata, activity_type')
    .in('activity_type', INBOUND_ACTIVITY_TYPES)
    .order('created_at', { ascending: false })
    .limit(RECENT_SMS_LIMIT)
  const scoped = leadId ? query.eq('lead_id', leadId) : query.eq('metadata->>from', phone)
  const { data, error } = await scoped
  if (error) throw suppressionError()
  return (data || []) as SmsActivityRow[]
}

function inboundOptOutAfter(rows: SmsActivityRow[], optedInAt: string | null): boolean {
  const cutoff = optedInAt ? Date.parse(optedInAt) : null
  return rows.some((row) => {
    if (!isInboundSms(row)) return false
    if (cutoff !== null && row.created_at) {
      const sentAt = Date.parse(row.created_at)
      if (!Number.isNaN(sentAt) && sentAt <= cutoff) return false
    }
    return typeof row.description === 'string' && isSmsOptOutMessage(row.description)
  })
}

export async function automatedSmsBlockReason(input: {
  phone: string
  leadId?: string | null
}): Promise<AutomatedSmsBlockReason | null> {
  const phone = normalizePhoneToE164(input.phone) ?? input.phone.trim()
  if (!phone) throw suppressionError()

  // Recipient allowlist: automated texts go to outside contacts only. Never
  // auto-text one of our own Twilio numbers (loops, self-alerts on junk).
  if (TWILIO_NUMBERS.some((number) => normalizePhoneToE164(number.value) === phone)) return 'company_number'

  const optOut = await loadOptOut(phone)
  if (optOut?.is_opted_out) return 'opted_out'

  const contact = await loadContactConsent(phone)
  if (contact?.sms_consent_status === 'opted_out') return 'contact_opted_out'

  const lead = await loadLeadSuppression(phone, input.leadId)
  if (lead.dnd) return 'dnd'

  const explicitOptIn = optOut?.is_opted_out === false || contact?.sms_consent_status === 'opted_in'
  const optedInAt = explicitOptIn
    ? latestTimestamp([
      optOut?.is_opted_out === false ? optOut.opted_in_at : null,
      contact?.sms_consent_status === 'opted_in' ? contact.consent_observed_at : null,
    ])
    : null
  const activities = await loadRecentSms(phone, lead.id)
  if (!inboundOptOutAfter(activities, optedInAt)) return null

  try {
    await handleOptOut(phone, 'NATURAL_LANGUAGE_OPT_OUT')
  } catch (error) {
    console.error('[sms-send-gate] inbound opt-out could not be persisted; send remains blocked', error)
  }
  return 'inbound_opt_out'
}

export type HumanSmsRefusalCode = 'sms_quiet_hours' | 'sms_dnc_blocked' | 'sms_registry_dnc'
export type SmsRegistryStatus = 'not_loaded' | 'checked'

export type HumanSmsSendDecision =
  | { ok: true; cold: boolean; warnings: string[]; registryStatus: SmsRegistryStatus | null }
  | { ok: false; code: HumanSmsRefusalCode; error: string }

const QUIET_HOURS_ERROR = "This text is outside 8:00am–9:00pm in the recipient's local time."
const DNC_ERROR = 'This number is blocked for SMS by a do-not-call or opt-out record.'
const DNC_UNKNOWN_ERROR = 'SMS suppression status could not be verified, so this send was not attempted.'
const REGISTRY_ERROR = 'This cold text is blocked because the number is on a do-not-call registry.'
const REGISTRY_UNKNOWN_ERROR = 'The do-not-call registry could not be checked, so this cold text was not sent.'
const OWNER_ACCEPTED_COLD_BASIS = 'owner_accepted_cold_1to1'

const DNC_LABELS = new Set(['dnc', 'do_not_call', 'dnc_number', 'dnc_contact', 'take_me_off'])
const PERSON_DNC_LABELS = new Set(['dnc', 'do_not_call', 'dnc_contact', 'take_me_off'])
const SOFT_REASONS = new Set(['wrong_number', 'disconnected', 'out_of_service_area'])
const DISCONNECTED_LABELS = new Set(['disconnected', 'bad_number', 'not_in_service', 'false', 'no'])
const THREAD_ACTIVITY_TYPES = ['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound']
const REGISTRY_TABLES = [
  'federal_dnc_registry',
  'national_dnc_registry',
  'ftc_dnc_registry',
  'mo_dnc_registry',
  'missouri_dnc_registry',
] as const

type ProspectPhoneRow = {
  phone: string | null
  phone_connected: string | boolean | null
  last_disposition: string | null
  voice_hold: boolean | string | null
  prospect_id?: string | null
  contact_name?: string | null
  relationship?: string | null
}

type ProspectRow = {
  id: string
  lead_id: string | null
  owner_1: string | null
}

type LeadDncRow = {
  id?: string
  phone: string | null
  full_name?: string | null
  dead_reason: string | null
  call_result: string | null
}

type ContactMethodRow = {
  normalized_value: string | null
  sms_consent_status: string | null
  deliverability_status: string | null
  person_id?: string | null
}

type OptOutStatusRow = {
  phone: string | null
  is_opted_out: boolean | null
}

type MojoEventRow = {
  normalized_phone: string | null
  outcome: string | null
  disposition_raw: string | null
}

type ThreadRow = SmsActivityRow & { lead_id?: string | null }
type RegistryProbe = 'hit' | 'clear' | 'absent' | 'error'

function last10(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

function label(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function personName(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function matchesPhone(value: string | null | undefined, phoneKey: string): boolean {
  return last10(value) === phoneKey
}

function isVoiceHold(value: boolean | string | null | undefined): boolean {
  return value === true || label(value) === 'true'
}

function isOwnerRelationship(value: string | null | undefined): boolean {
  const relationship = label(value)
  return relationship === 'owner' || relationship === 'primary_owner' || relationship === 'property_owner'
}

function softReason(value: string): 'wrong_number' | 'disconnected' | 'out_of_service_area' | null {
  if (value === 'wrong_number') return 'wrong_number'
  if (value === 'out_of_service_area') return 'out_of_service_area'
  if (DISCONNECTED_LABELS.has(value)) return 'disconnected'
  return null
}

function isMissingRelation(error: { code?: string; message?: string }): boolean {
  const code = String(error.code || '')
  const message = String(error.message || '').toLowerCase()
  return code === '42P01'
    || code === 'PGRST205'
    || message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find the table')
}

function hasDocumentedConsent(row: ThreadRow): boolean {
  const metadata = row.metadata
  if (!metadata) return false
  const basis = typeof metadata.consent_basis === 'string' ? metadata.consent_basis.trim() : ''
  if (basis && basis !== OWNER_ACCEPTED_COLD_BASIS) return true
  return metadata.sms_consent === true || metadata.consent === true || metadata.consented === true
}

function warmsHumanThread(row: ThreadRow): boolean {
  const description = typeof row.description === 'string' ? row.description : ''
  if (description && isSmsOptOutMessage(description)) return false
  return hasDocumentedConsent(row) || isInboundSms(row)
}

function activityIsAboutPhone(row: ThreadRow, phoneKey: string, leadId: string | null): boolean {
  const from = typeof row.metadata?.from === 'string' ? last10(row.metadata.from) : null
  const to = typeof row.metadata?.to === 'string' ? last10(row.metadata.to) : null
  if (from || to) return from === phoneKey || to === phoneKey
  return Boolean(leadId) && row.lead_id === leadId
}

function leadIsPersonDnc(lead: LeadDncRow): boolean {
  const dead = label(lead.dead_reason)
  const callResult = label(lead.call_result)
  return canonicalDeadReason(lead.dead_reason) === 'dnc_refused'
    || PERSON_DNC_LABELS.has(dead)
    || PERSON_DNC_LABELS.has(callResult)
}

function personKeys(phone: ProspectPhoneRow, methods: ContactMethodRow[]): string[] {
  const keys: string[] = []
  const phoneKey = last10(phone.phone)
  const name = personName(phone.contact_name)
  if (phone.prospect_id && name) keys.push(`name:${phone.prospect_id}:${name}`)
  if (phoneKey) {
    for (const method of methods) {
      if (method.person_id && matchesPhone(method.normalized_value, phoneKey)) keys.push(`crm:${method.person_id}`)
    }
  }
  return keys
}

function samePersonBlocks(input: {
  phoneKey: string
  phones: ProspectPhoneRow[]
  prospects: ProspectRow[]
  leads: LeadDncRow[]
  methods: ContactMethodRow[]
}): boolean {
  const dncLeadPhones = new Set<string>()
  for (const lead of input.leads) {
    if (!leadIsPersonDnc(lead)) continue
    const key = last10(lead.phone)
    if (key) dncLeadPhones.add(key)
  }
  const prospectsById = new Map(input.prospects.map((prospect) => [prospect.id, prospect]))

  function phoneIsPersonDnc(phone: ProspectPhoneRow): boolean {
    if (PERSON_DNC_LABELS.has(label(phone.last_disposition))) return true
    const key = last10(phone.phone)
    if (key && dncLeadPhones.has(key)) return true
    const prospect = phone.prospect_id ? prospectsById.get(phone.prospect_id) : undefined
    if (!prospect?.lead_id) return false
    const lead = input.leads.find((row) => row.id === prospect.lead_id)
    if (!lead || !leadIsPersonDnc(lead)) return false
    const name = personName(phone.contact_name) || (isOwnerRelationship(phone.relationship) ? personName(prospect.owner_1) : '')
    return Boolean(name) && name === personName(lead.full_name)
  }

  const destinationKeys = new Set<string>()
  for (const phone of input.phones) {
    if (!matchesPhone(phone.phone, input.phoneKey)) continue
    for (const key of personKeys(phone, input.methods)) destinationKeys.add(key)
  }
  for (const method of input.methods) {
    if (method.person_id && matchesPhone(method.normalized_value, input.phoneKey)) destinationKeys.add(`crm:${method.person_id}`)
  }

  for (const phone of input.phones) {
    if (!phoneIsPersonDnc(phone)) continue
    if (personKeys(phone, input.methods).some((key) => destinationKeys.has(key))) return true
  }

  const ownerDncProspects = new Set<string>()
  for (const phone of input.phones) {
    if (!phone.prospect_id || !isOwnerRelationship(phone.relationship) || !phoneIsPersonDnc(phone)) continue
    ownerDncProspects.add(phone.prospect_id)
  }
  return input.phones.some((phone) => (
    matchesPhone(phone.phone, input.phoneKey)
    && Boolean(phone.prospect_id)
    && ownerDncProspects.has(phone.prospect_id || '')
  ))
}

async function rowsForPhone<T>(
  table: string,
  column: string,
  variants: string[],
  columns: string,
): Promise<T[]> {
  if (!variants.length) return []
  const { data, error } = await supabase.from(table).select(columns).in(column, variants).limit(200)
  if (error) throw suppressionError()
  return (data || []) as T[]
}

async function rowsByIds<T>(table: string, column: string, ids: string[], columns: string): Promise<T[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from(table).select(columns).in(column, ids).limit(500)
  if (error) throw suppressionError()
  return (data || []) as T[]
}

async function blockReasonFromRegistry(phone: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('source_list_phone_block_reason_v1', { p_phone: phone })
  if (error) throw suppressionError()
  return typeof data === 'string' && data.trim() ? data.trim() : null
}

async function threadRows(leadId: string | null, variants: string[]): Promise<ThreadRow[]> {
  const columns = 'lead_id, description, created_at, metadata, activity_type'
  const rows: ThreadRow[] = []
  if (leadId) {
    const { data, error } = await supabase
      .from('lead_activities')
      .select(columns)
      .eq('lead_id', leadId)
      .in('activity_type', THREAD_ACTIVITY_TYPES)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw suppressionError()
    rows.push(...((data || []) as ThreadRow[]))
  }
  if (variants.length) {
    const [fromRows, toRows] = await Promise.all([
      supabase.from('lead_activities').select(columns).in('activity_type', THREAD_ACTIVITY_TYPES).in('metadata->>from', variants).limit(100),
      supabase.from('lead_activities').select(columns).in('activity_type', THREAD_ACTIVITY_TYPES).in('metadata->>to', variants).limit(100),
    ])
    if (fromRows.error || toRows.error) throw suppressionError()
    rows.push(...((fromRows.data || []) as ThreadRow[]), ...((toRows.data || []) as ThreadRow[]))
  }
  return rows
}

async function registryTableProbe(table: string, phoneKey: string, variants: string[]): Promise<RegistryProbe> {
  if (!variants.length) return 'error'
  try {
    const { data, error } = await supabase.from(table).select('phone').in('phone', variants).limit(20)
    if (error) return isMissingRelation(error) ? 'absent' : 'error'
    const rows = (data || []) as Array<{ phone?: string | null }>
    return rows.some((row) => matchesPhone(row.phone, phoneKey)) ? 'hit' : 'clear'
  } catch {
    return 'error'
  }
}

/**
 * Quiet hours, full DNC labels, and the cold-only registry flag for a human
 * 1:1 text. Existing automatedSmsBlockReason checks stay in place; this does
 * not replace them. Lookup failures refuse the send. A prior cold send is not
 * consent. When no federal or Missouri registry table is loaded, a cold send
 * stays allowed under EXC-004 and records registry_status not_loaded.
 */
export async function evaluateHumanOneToOneSms(input: {
  phone: string
  leadId?: string | null
  now?: Date
}): Promise<HumanSmsSendDecision> {
  const now = input.now ?? new Date()
  if (!isWithinRecipientSmsHours(input.phone, now)) {
    return { ok: false, code: 'sms_quiet_hours', error: QUIET_HOURS_ERROR }
  }

  const phone = normalizePhoneToE164(input.phone) ?? input.phone.trim()
  const phoneKey = last10(phone)
  if (!phoneKey) return { ok: false, code: 'sms_dnc_blocked', error: DNC_UNKNOWN_ERROR }

  try {
    const variants = phoneLookupVariants(phone)
    const leadId = input.leadId ?? null
    const [registryReason, optOuts, matchedPhones, methods, leads, mojoEvents, thread, leadRow] = await Promise.all([
      blockReasonFromRegistry(phone),
      rowsForPhone<OptOutStatusRow>('sms_opt_outs', 'phone', variants, 'phone, is_opted_out'),
      rowsForPhone<ProspectPhoneRow>('prospect_phones', 'phone', variants, 'phone, phone_connected, last_disposition, voice_hold, prospect_id, contact_name, relationship'),
      rowsForPhone<ContactMethodRow>('crm_contact_methods', 'normalized_value', variants, 'normalized_value, sms_consent_status, deliverability_status, person_id'),
      rowsForPhone<LeadDncRow>('leads', 'phone', variants, 'id, phone, full_name, dead_reason, call_result'),
      rowsForPhone<MojoEventRow>('crm_mojo_call_events', 'normalized_phone', variants, 'normalized_phone, outcome, disposition_raw'),
      threadRows(leadId, variants),
      leadId
        ? supabase.from('leads').select('id, phone, full_name, dead_reason, call_result').eq('id', leadId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    if (leadRow.error) throw suppressionError()

    const destinationPhones = matchedPhones.filter((row) => matchesPhone(row.phone, phoneKey))
    const prospectIds = [...new Set(destinationPhones.map((row) => row.prospect_id).filter((id): id is string => Boolean(id)))]
    const personIds = [...new Set(methods.map((row) => row.person_id).filter((id): id is string => Boolean(id)))]
    const [propertyPhones, prospects, personMethods] = await Promise.all([
      rowsByIds<ProspectPhoneRow>('prospect_phones', 'prospect_id', prospectIds, 'phone, phone_connected, last_disposition, voice_hold, prospect_id, contact_name, relationship'),
      rowsByIds<ProspectRow>('prospects', 'id', prospectIds, 'id, lead_id, owner_1'),
      rowsByIds<ContactMethodRow>('crm_contact_methods', 'person_id', personIds, 'normalized_value, sms_consent_status, deliverability_status, person_id'),
    ])
    const siblingVariants = [...new Set(personMethods.flatMap((row) => phoneLookupVariants(row.normalized_value || '')))]
    const siblingPhones = await rowsForPhone<ProspectPhoneRow>('prospect_phones', 'phone', siblingVariants, 'phone, phone_connected, last_disposition, voice_hold, prospect_id, contact_name, relationship')
    const leadIds = [...new Set(prospects.map((row) => row.lead_id).filter((id): id is string => Boolean(id)))]
    const linkedLeads = await rowsByIds<LeadDncRow>('leads', 'id', leadIds, 'id, phone, full_name, dead_reason, call_result')
    const relatedPhones = [...destinationPhones, ...propertyPhones, ...siblingPhones]
    const relatedMethods = [...methods, ...personMethods]
    const relatedLeads = [...leads, ...linkedLeads]
    const directLead = leadRow.data as LeadDncRow | null
    if (directLead) relatedLeads.push(directLead)

    const warnings = new Set<string>()
    let blocked = false
    let dataskip = false

    if (registryReason) {
      if (SOFT_REASONS.has(registryReason)) warnings.add(registryReason)
      else blocked = true
    }

    for (const row of optOuts) {
      if (matchesPhone(row.phone, phoneKey) && row.is_opted_out) blocked = true
    }

    for (const row of destinationPhones) {
      if (isVoiceHold(row.voice_hold) || DNC_LABELS.has(label(row.last_disposition))) blocked = true
      const connected = label(row.phone_connected)
      if (connected === 'dataskip_dnc') dataskip = true
      const soft = softReason(label(row.last_disposition)) || softReason(connected)
      if (soft) warnings.add(soft)
    }

    for (const row of methods.filter((item) => matchesPhone(item.normalized_value, phoneKey))) {
      if (row.sms_consent_status === 'opted_out' || row.deliverability_status === 'blocked') blocked = true
    }

    for (const row of relatedLeads.filter((item) => matchesPhone(item.phone, phoneKey))) {
      const dead = label(row.dead_reason)
      const callResult = label(row.call_result)
      if (canonicalDeadReason(row.dead_reason) === 'dnc_refused' || DNC_LABELS.has(dead) || DNC_LABELS.has(callResult)) {
        blocked = true
      }
    }

    for (const row of mojoEvents.filter((item) => matchesPhone(item.normalized_phone, phoneKey))) {
      const outcome = label(row.outcome)
      const disposition = label(row.disposition_raw)
      if (outcome === 'dnc' || DNC_LABELS.has(outcome) || DNC_LABELS.has(disposition)) blocked = true
      const soft = softReason(outcome) || softReason(disposition)
      if (soft) warnings.add(soft)
    }

    if (!blocked && samePersonBlocks({
      phoneKey,
      phones: relatedPhones,
      prospects,
      leads: relatedLeads,
      methods: relatedMethods,
    })) blocked = true

    if (blocked) return { ok: false, code: 'sms_dnc_blocked', error: DNC_ERROR }

    const cold = !thread.some((row) => activityIsAboutPhone(row, phoneKey, leadId) && warmsHumanThread(row))
    if (cold && dataskip) return { ok: false, code: 'sms_registry_dnc', error: REGISTRY_ERROR }

    let registryStatus: SmsRegistryStatus | null = null
    if (cold) {
      const probes = await Promise.all(REGISTRY_TABLES.map((table) => registryTableProbe(table, phoneKey, variants)))
      if (probes.includes('hit')) return { ok: false, code: 'sms_registry_dnc', error: REGISTRY_ERROR }
      if (probes.includes('error')) return { ok: false, code: 'sms_registry_dnc', error: REGISTRY_UNKNOWN_ERROR }
      registryStatus = probes.includes('clear') ? 'checked' : 'not_loaded'
    }

    return { ok: true, cold, warnings: [...warnings], registryStatus }
  } catch (error) {
    console.error('[sms-send-gate] human SMS suppression lookup failed', error)
    return { ok: false, code: 'sms_dnc_blocked', error: DNC_UNKNOWN_ERROR }
  }
}
