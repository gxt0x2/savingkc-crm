/**
 * Label policy for the dialer / Mojo export scrub.
 *
 * The running check is public.dialer_suppression_class_v1 in
 * supabase/migrations/20261202140000_dialer_export_suppression.sql.
 * These arrays are the same sets. The migration test fails if they drift.
 * dataskip_dnc is an explicit allow. A label that is not allow and not block
 * is unmapped, and unmapped fails closed.
 */

export const PROSPECT_PHONE_DNC = ['dnc', 'do_not_call', 'dnc_number'] as const
export const PROSPECT_PERSON_DNC = ['dnc_contact', 'take_me_off'] as const
export const PROSPECT_DEAD = ['dead', 'fax', 'disconnected', 'bad_number', 'not_in_service'] as const
export const PROSPECT_WRONG = ['wrong_number'] as const
export const PROSPECT_ALLOW = [
  'no_answer',
  'left_voicemail',
  'left_vm',
  'not_interested',
  'spoke_with_owner',
  'callback_requested',
  'busy',
  'appointment_set',
  'deal_potential',
  'offer_made',
  'answered',
  'contact',
  'interested',
] as const

export const PHONE_CONNECTED_ALLOW = ['connected', 'dataskip_dnc'] as const
export const PHONE_CONNECTED_DISCONNECTED = ['disconnected', 'false', 'no', 'bad_number'] as const

export const LEAD_CALL_DEAD = ['dead', 'bad_number'] as const
export const LEAD_CALL_ALLOW = [
  'no_answer',
  'contact',
  'interested',
  'callback_requested',
  'answered',
  'spoke_with_owner',
  'activity_deleted',
  'not_interested',
  'left_voicemail',
  'left_vm',
  'appointment_set',
] as const

export const LEAD_DEAD_PHONE_DNC = ['dnc', 'do_not_call'] as const
export const LEAD_DEAD_PERSON = ['dnc_refused'] as const
export const LEAD_DEAD_DISCONNECTED = ['wrong_or_disconnected', 'disconnected'] as const
export const LEAD_DEAD_ALLOW = [
  'other',
  'spam_vendor_duplicate',
  'not_selling',
  'spam',
  'sold_or_competitor',
  'listed_agent',
  'outside_buy_box',
  'no_legal_interest',
  'low_offer_or_equity',
  'went_with_someone_else',
  'already_sold',
  'internal_test',
  'listed',
  'fake_test_orphan_555_booking_probe',
  'not_pursuing',
] as const

export const MOJO_ALLOW = [
  'no_answer',
  'other',
  'voicemail_left',
  'meaningful_conversation',
  'callback_scheduled',
  'appointment_set',
  'busy',
] as const

/** Never overwritten by a weaker Mojo stamp. dead is protected; fax is not. */
export const NEVER_DOWNGRADE = [...PROSPECT_PHONE_DNC, ...PROSPECT_PERSON_DNC, 'dead'] as const

export type SuppressionSource =
  | 'prospect_disposition'
  | 'phone_connected'
  | 'lead_call_result'
  | 'lead_dead_reason'
  | 'mojo_outcome'
  | 'never_downgrade'

export interface SuppressionPhone {
  phone: string
  prospectId?: string | null
  lastDisposition?: string | null
  phoneConnected?: string | null
  voiceHold?: boolean | null
}

export interface SuppressionProspect {
  id: string
  leadId?: string | null
  county?: string | null
  street?: string | null
  ownerLast?: string | null
  ownerName?: string | null
}

export interface SuppressionLead {
  id: string
  phone?: string | null
  callResult?: string | null
  deadReason?: string | null
}

export interface SuppressionMojoEvent {
  phone: string
  outcome?: string | null
  providerContactId?: string | null
}

export interface SuppressionOptOut {
  phone: string
  optedOut?: boolean | null
}

export interface SuppressionContact {
  phone: string
  smsConsent?: string | null
  deliverability?: string | null
}

export interface SuppressionWorld {
  phones?: readonly SuppressionPhone[]
  prospects?: readonly SuppressionProspect[]
  leads?: readonly SuppressionLead[]
  mojoEvents?: readonly SuppressionMojoEvent[]
  optOuts?: readonly SuppressionOptOut[]
  contacts?: readonly SuppressionContact[]
  encodePending?: readonly string[]
}

export function labelKey(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return text || null
}

export function phoneDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

/** Last 10 digits when the number has at least 10. Shorter values stay short. */
export function phoneKey(value: string | null | undefined): string {
  const digits = phoneDigits(value)
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

export function isDialablePhone(value: string | null | undefined): boolean {
  const digits = phoneDigits(value)
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))
}

export function householdKey(prospect: SuppressionProspect | null | undefined): string | null {
  if (!prospect) return null
  const county = String(prospect.county ?? '').trim().toLowerCase()
  const street = String(prospect.street ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  let owner = String(prospect.ownerLast ?? '').trim().toLowerCase()
  if (!owner) {
    const name = String(prospect.ownerName ?? '').trim().toLowerCase()
    if (name.includes(',')) owner = name.split(',')[0]?.trim() ?? ''
    else owner = name.split(/\s+/).filter(Boolean).at(-1) ?? ''
  }
  if (!county || !street || !owner) return null
  return `${county}|${street}|${owner}`
}

function listed(label: string | null, values: readonly string[]): boolean {
  return Boolean(label && values.includes(label))
}

export function suppressionClass(source: SuppressionSource, raw: string | null | undefined): string | null {
  const label = labelKey(raw)
  if (source === 'never_downgrade') {
    return listed(label, NEVER_DOWNGRADE) ? 'protected' : null
  }
  if (!label) return null

  if (source === 'prospect_disposition') {
    if (listed(label, PROSPECT_PHONE_DNC)) return 'prospect_dnc'
    if (listed(label, PROSPECT_PERSON_DNC)) return 'person_dnc'
    if (listed(label, PROSPECT_WRONG)) return 'wrong_number'
    if (listed(label, PROSPECT_DEAD)) return 'disconnected'
    if (listed(label, PROSPECT_ALLOW)) return 'allow'
    return 'unmapped'
  }
  if (source === 'phone_connected') {
    if (listed(label, PROSPECT_WRONG)) return 'wrong_number'
    if (listed(label, PHONE_CONNECTED_DISCONNECTED)) return 'disconnected'
    if (listed(label, PHONE_CONNECTED_ALLOW)) return 'allow'
    return 'unmapped'
  }
  if (source === 'lead_call_result') {
    if (listed(label, PROSPECT_PERSON_DNC)) return 'person_dnc'
    if (listed(label, PROSPECT_PHONE_DNC)) return 'lead_dnc'
    if (listed(label, LEAD_CALL_DEAD)) return 'dead_number'
    if (listed(label, LEAD_CALL_ALLOW)) return 'allow'
    return 'unmapped'
  }
  if (source === 'lead_dead_reason') {
    if (listed(label, LEAD_DEAD_PERSON)) return 'person_dnc'
    if (listed(label, LEAD_DEAD_PHONE_DNC)) return 'lead_dnc'
    if (listed(label, LEAD_DEAD_DISCONNECTED)) return 'disconnected'
    if (listed(label, LEAD_DEAD_ALLOW)) return 'allow'
    return 'unmapped'
  }
  if (label === 'dnc') return 'mojo_dnc'
  if (label === 'disconnected') return 'disconnected'
  if (listed(label, MOJO_ALLOW)) return 'allow'
  return 'unmapped'
}

function phonesOf(world: SuppressionWorld): readonly SuppressionPhone[] {
  return world.phones ?? []
}

function sameKey(phone: string, key: string): boolean {
  return phoneKey(phone) === key
}

function blockingClass(source: SuppressionSource, raw: string | null | undefined): string | null {
  const value = suppressionClass(source, raw)
  if (!value || value === 'allow') return null
  return value
}

function personLevelLead(lead: SuppressionLead | undefined): boolean {
  if (!lead) return false
  return suppressionClass('lead_dead_reason', lead.deadReason) === 'person_dnc'
    || suppressionClass('lead_call_result', lead.callResult) === 'person_dnc'
}

function personLevelPhone(phone: SuppressionPhone | undefined): boolean {
  return suppressionClass('prospect_disposition', phone?.lastDisposition) === 'person_dnc'
}

function prospectIdsFor(world: SuppressionWorld, key: string, prospectId?: string | null): Set<string> {
  const ids = new Set<string>()
  if (prospectId) ids.add(prospectId)
  for (const phone of phonesOf(world)) {
    if (phone.prospectId && sameKey(phone.phone, key)) ids.add(phone.prospectId)
  }
  return ids
}

function personFanout(world: SuppressionWorld, key: string, prospectId?: string | null): boolean {
  const prospectIds = prospectIdsFor(world, key, prospectId)
  for (const id of prospectIds) {
    if (phonesOf(world).some((phone) => phone.prospectId === id && !sameKey(phone.phone, key) && personLevelPhone(phone))) {
      return true
    }
    const prospect = world.prospects?.find((item) => item.id === id)
    const lead = world.leads?.find((item) => item.id === prospect?.leadId)
    if (personLevelLead(lead) && !sameKey(lead?.phone ?? '', key)) return true
  }

  const contactIds = new Set(
    (world.mojoEvents ?? [])
      .filter((event) => event.providerContactId && sameKey(event.phone, key))
      .map((event) => event.providerContactId as string),
  )
  for (const contactId of contactIds) {
    for (const other of world.mojoEvents ?? []) {
      if (other.providerContactId !== contactId || sameKey(other.phone, key)) continue
      const otherKey = phoneKey(other.phone)
      if (phonesOf(world).some((phone) => phoneKey(phone.phone) === otherKey && personLevelPhone(phone))) return true
      if ((world.leads ?? []).some((lead) => phoneKey(lead.phone) === otherKey && personLevelLead(lead))) return true
    }
  }
  return false
}

function householdFanout(world: SuppressionWorld, key: string, prospectId?: string | null): boolean {
  const mineIds = prospectIdsFor(world, key, prospectId)
  for (const id of mineIds) {
    const mineKey = householdKey(world.prospects?.find((item) => item.id === id))
    if (!mineKey) continue
    for (const anchor of world.prospects ?? []) {
      if (mineIds.has(anchor.id) || householdKey(anchor) !== mineKey) continue
      if (phonesOf(world).some((phone) => phone.prospectId === anchor.id && personLevelPhone(phone))) return true
      const lead = world.leads?.find((item) => item.id === anchor.leadId)
      if (personLevelLead(lead)) return true
    }
  }
  return false
}

function shortSuppressionMatch(world: SuppressionWorld, key: string): boolean {
  const last4 = key.slice(-4)
  const short = (phone: string) => {
    const stored = phoneKey(phone)
    return stored.length >= 4 && stored.length < 10 && stored.slice(-4) === last4
  }
  if (phonesOf(world).some((phone) => short(phone.phone) && (
    blockingClass('prospect_disposition', phone.lastDisposition)
    || blockingClass('phone_connected', phone.phoneConnected)
    || phone.voiceHold === true
  ))) return true
  if ((world.leads ?? []).some((lead) => short(lead.phone ?? '') && (
    blockingClass('lead_call_result', lead.callResult) || blockingClass('lead_dead_reason', lead.deadReason)
  ))) return true
  if ((world.mojoEvents ?? []).some((event) => short(event.phone) && blockingClass('mojo_outcome', event.outcome))) return true
  if ((world.optOuts ?? []).some((row) => row.optedOut !== false && short(row.phone))) return true
  if ((world.encodePending ?? []).some((phone) => short(phone))) return true
  return false
}

const PROSPECT_REASON_ORDER = ['prospect_dnc', 'wrong_number', 'disconnected', 'unmapped_label'] as const
const LEAD_REASON_ORDER = ['lead_dnc', 'dead_number', 'disconnected', 'unmapped_label'] as const
const MOJO_REASON_ORDER = ['mojo_dnc', 'disconnected', 'unmapped_label'] as const

function firstReason(reasons: readonly (string | null)[], order: readonly string[]): string | null {
  for (const name of order) {
    if (reasons.includes(name)) return name
  }
  return null
}

function reasonFromProspectClass(value: string): string | null {
  if (value === 'person_dnc' || value === 'prospect_dnc') return 'prospect_dnc'
  if (value === 'wrong_number') return 'wrong_number'
  if (value === 'disconnected') return 'disconnected'
  if (value === 'unmapped') return 'unmapped_label'
  return null
}

function reasonFromLeadClass(value: string): string | null {
  if (value === 'person_dnc' || value === 'lead_dnc') return 'lead_dnc'
  if (value === 'dead_number') return 'dead_number'
  if (value === 'disconnected') return 'disconnected'
  if (value === 'unmapped') return 'unmapped_label'
  return null
}

function reasonFromMojoClass(value: string): string | null {
  if (value === 'mojo_dnc') return 'mojo_dnc'
  if (value === 'disconnected') return 'disconnected'
  if (value === 'unmapped') return 'unmapped_label'
  return null
}

/**
 * Fail-closed export decision for one phone.
 * Null means the number may be exported. Direct last-10 matches win over fan-out.
 * A stored suppression that cannot be matched on 10 digits is hold_last4, not a pass.
 */
export function exportBlockReason(
  phone: string,
  world: SuppressionWorld = {},
  prospectId?: string | null,
): string | null {
  if (!isDialablePhone(phone)) return 'invalid_phone'
  const key = phoneKey(phone)

  if ((world.optOuts ?? []).some((row) => row.optedOut !== false && sameKey(row.phone, key))) return 'sms_opt_out'
  if (phonesOf(world).some((row) => row.voiceHold === true && sameKey(row.phone, key))) return 'voice_hold'

  const prospectReason = firstReason(
    phonesOf(world).filter((row) => sameKey(row.phone, key)).map((row) => reasonFromProspectClass(blockingClass('prospect_disposition', row.lastDisposition) ?? '')),
    PROSPECT_REASON_ORDER,
  )
  if (prospectReason) return prospectReason
  const connectedReason = firstReason(
    phonesOf(world).filter((row) => sameKey(row.phone, key)).map((row) => reasonFromProspectClass(blockingClass('phone_connected', row.phoneConnected) ?? '')),
    PROSPECT_REASON_ORDER,
  )
  if (connectedReason) return connectedReason
  for (const row of world.contacts ?? []) {
    if (!sameKey(row.phone, key)) continue
    if (row.smsConsent === 'opted_out') return 'contact_opt_out'
    if (row.deliverability === 'blocked') return 'contact_blocked'
  }
  const leadReason = firstReason(
    (world.leads ?? []).filter((lead) => sameKey(lead.phone ?? '', key)).flatMap((lead) => [
      reasonFromLeadClass(blockingClass('lead_call_result', lead.callResult) ?? ''),
      reasonFromLeadClass(blockingClass('lead_dead_reason', lead.deadReason) ?? ''),
    ]),
    LEAD_REASON_ORDER,
  )
  if (leadReason) return leadReason
  const mojoReason = firstReason(
    (world.mojoEvents ?? []).filter((event) => sameKey(event.phone, key)).map((event) => reasonFromMojoClass(blockingClass('mojo_outcome', event.outcome) ?? '')),
    MOJO_REASON_ORDER,
  )
  if (mojoReason) return mojoReason

  if (personFanout(world, key, prospectId)) return 'person_fanout'
  if (householdFanout(world, key, prospectId)) return 'household_fanout'
  if ((world.encodePending ?? []).some((row) => sameKey(row, key))) return 'mojo_encode_pending'
  if (shortSuppressionMatch(world, key)) return 'hold_last4'
  return null
}
