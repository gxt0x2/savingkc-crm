import { canonicalDeadReason } from '@/lib/lead-outcomes'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { handleOptOut, isSmsOptOutMessage } from '@/lib/sms-opt-out'
import { supabase } from '@/lib/supabase-lazy'

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
