/** Label sets for the dialer export. dataskip_dnc is an allow. Anything else non-blank is unmapped. */

export const PROSPECT_PHONE_DNC = ['dnc', 'do_not_call', 'dnc_number'] as const
export const PROSPECT_PERSON_DNC = ['dnc_contact', 'take_me_off'] as const
export const PROSPECT_DEAD = ['dead', 'fax', 'disconnected', 'bad_number', 'not_in_service'] as const
export const PROSPECT_WRONG = ['wrong_number'] as const
export const PROSPECT_ALLOW = ['no_answer', 'left_voicemail', 'left_vm', 'not_interested', 'spoke_with_owner', 'callback_requested', 'busy', 'appointment_set', 'deal_potential', 'offer_made', 'answered', 'contact', 'interested'] as const

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

/** Raw Mojo labels that are not a suppression. Checked before outcome. */
export const MOJO_RAW_ALLOW = ['no_contact', 'no_answer', 'answering_machine', 'other', 'voicemail', 'contact', 'skipped', 'callback_requested', 'interested', 'incomplete', 'appointment_set', 'busy'] as const

export const MOJO_RAW_DEAD = ['fax', 'dead'] as const
export const MOJO_RAW_DISCONNECTED = ['bad_number', 'not_in_service', 'disconnected'] as const

/** Never overwritten by a weaker Mojo stamp. dead is protected; fax is not. */
export const NEVER_DOWNGRADE = [...PROSPECT_PHONE_DNC, ...PROSPECT_PERSON_DNC, 'dead'] as const

/** Property-owner fan-out treats these dispositions as owner DNC. Disconnected and bad_number do not. */
export const PROPERTY_OWNER_DNC = [...PROSPECT_PHONE_DNC, ...PROSPECT_PERSON_DNC, 'dead', 'fax'] as const

export const OWNER_RELATIONSHIPS = ['owner', 'subject', 'co_owner'] as const
export const RELATIVE_RELATIONSHIPS = ['relative', 'spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative'] as const
export const RELATIVE_OWNER_TYPES = ['in_law', 'child', 'parent', 'sibling', 'spouse', 'other_relative', 'unknown', 'individual'] as const
export const ASSOCIATE_OWNER_TYPES = ['neighbor', 'coworker', 'past_neighbor', 'friend', 'landlord', 'tenant'] as const
export const UNKNOWN_RELATIONSHIPS = ['unknown', 'entity_contact'] as const

/** Refuses line mode greater than 1 unless an operator turns the flag off. */
export const MULTI_LINE_SUSPENDED_DEFAULT = true

export type RelationshipBucket = 'owner' | 'relative' | 'associate_non_family' | 'relationship_unknown'

export type SuppressionSource =
  | 'prospect_disposition'
  | 'phone_connected'
  | 'lead_call_result'
  | 'lead_dead_reason'
  | 'mojo_outcome'
  | 'mojo_disposition_raw'
  | 'never_downgrade'

export interface SuppressionPhone {
  phone: string
  prospectId?: string | null
  lastDisposition?: string | null
  phoneConnected?: string | null
  voiceHold?: boolean | null
  voiceHoldReason?: string | null
  relationship?: string | null
  contactName?: string | null
  verifiedSource?: string | null
  entityRole?: string | null
}

export interface SuppressionProspect {
  id: string
  leadId?: string | null
  county?: string | null
  street?: string | null
  ownerLast?: string | null
  ownerName?: string | null
  ownerType?: string | null
  parcelId?: string | null
  zip?: string | null
  skipTraced?: boolean | null
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
  dispositionRaw?: string | null
  providerContactId?: string | null
  recordId?: string | null
}

export interface SuppressionMojoCall {
  phoneLast4: string
  resultLabel?: string | null
  recordId?: string | null
  providerContactId?: string | null
  leadId?: string | null
  hasFullPhone?: boolean | null
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
  county?: string | null
  situsCounty?: string | null
  phones?: readonly SuppressionPhone[]
  prospects?: readonly SuppressionProspect[]
  leads?: readonly SuppressionLead[]
  mojoEvents?: readonly SuppressionMojoEvent[]
  optOuts?: readonly SuppressionOptOut[]
  contacts?: readonly SuppressionContact[]
  encodePending?: readonly string[]
  mojoCalls?: readonly SuppressionMojoCall[]
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

export function normalizeStreet(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function relationshipBucket(
  relationship: string | null | undefined,
  ownerType: string | null | undefined,
): RelationshipBucket {
  const rel = labelKey(relationship)
  const owner = labelKey(ownerType)
  if (rel === 'associate' || (owner !== null && ASSOCIATE_OWNER_TYPES.includes(owner as typeof ASSOCIATE_OWNER_TYPES[number]))) {
    return 'associate_non_family'
  }
  if (rel !== null && OWNER_RELATIONSHIPS.includes(rel as typeof OWNER_RELATIONSHIPS[number])) return 'owner'
  if (rel !== null && UNKNOWN_RELATIONSHIPS.includes(rel as typeof UNKNOWN_RELATIONSHIPS[number])) return 'relationship_unknown'
  if (
    (rel !== null && RELATIVE_RELATIONSHIPS.includes(rel as typeof RELATIVE_RELATIONSHIPS[number]))
    || (owner !== null && RELATIVE_OWNER_TYPES.includes(owner as typeof RELATIVE_OWNER_TYPES[number]))
  ) return 'relative'
  return 'relationship_unknown'
}

export function propertyKey(prospect: SuppressionProspect | null | undefined): string | null {
  if (!prospect) return null
  const parcel = String(prospect.parcelId ?? '').replace(/\s+/g, '').toUpperCase()
  if (parcel) return `parcel:${parcel}`
  const county = String(prospect.county ?? '').trim().toLowerCase()
  const street = normalizeStreet(prospect.street)
  if (!county || !street) return null
  const zipDigits = String(prospect.zip ?? '').replace(/\D/g, '')
  if (zipDigits.length >= 5) return `addr:${county}|${street}|${zipDigits.slice(0, 5)}`
  if (!zipDigits) return `addr:${county}|${street}`
  return `addr:${county}|${street}|${zipDigits}`
}

export function exportLineModeBlock(lineMode: number, suspended = MULTI_LINE_SUSPENDED_DEFAULT): 'multi_line_suspended' | null {
  if (!Number.isInteger(lineMode) || lineMode < 1) return 'multi_line_suspended'
  if (suspended && lineMode > 1) return 'multi_line_suspended'
  return null
}

export function householdKey(prospect: SuppressionProspect | null | undefined): string | null {
  if (!prospect) return null
  const county = String(prospect.county ?? '').trim().toLowerCase()
  const street = normalizeStreet(prospect.street)
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
    if (listed(label, LEAD_DEAD_PERSON) || listed(label, LEAD_DEAD_PHONE_DNC)) return 'person_dnc'
    if (listed(label, LEAD_DEAD_DISCONNECTED)) return 'disconnected'
    if (listed(label, LEAD_DEAD_ALLOW)) return 'allow'
    return 'unmapped'
  }
  if (source === 'mojo_disposition_raw') {
    if (listed(label, MOJO_RAW_DEAD) || listed(label, MOJO_RAW_DISCONNECTED)) return 'disconnected'
    if (listed(label, PROSPECT_PERSON_DNC)) return 'person_dnc'
    if (listed(label, PROSPECT_PHONE_DNC)) return 'mojo_dnc'
    if (listed(label, PROSPECT_WRONG)) return 'wrong_number'
    if (listed(label, MOJO_RAW_ALLOW)) return 'allow'
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
  if (labelKey(lead.callResult) === 'dnc_number' && labelKey(lead.deadReason) !== 'dnc_refused') return false
  return suppressionClass('lead_dead_reason', lead.deadReason) === 'person_dnc'
    || suppressionClass('lead_call_result', lead.callResult) === 'person_dnc'
}

function mojoRawPerson(world: SuppressionWorld, phone: string): boolean {
  return (world.mojoEvents ?? []).some((event) => (
    sameKey(event.phone, phoneKey(phone))
    && suppressionClass('mojo_disposition_raw', event.dispositionRaw) === 'person_dnc'
  ))
}

function fanoutHoldReason(reason: string | null | undefined): boolean {
  return (labelKey(reason) ?? '').includes('mojo_dnc_contact_fanout')
}

function counselOrPersonHold(world: SuppressionWorld, key: string, prospectId?: string | null): 'person_fanout' | 'needs_counsel_review' | null {
  const anchors = phonesOf(world).filter((phone) => phone.voiceHold === true && fanoutHoldReason(phone.voiceHoldReason) && phoneKey(phone.phone).length === 10)
  if (anchors.length === 0) return null
  const personProspects = new Set(anchors.map((phone) => phone.prospectId).filter((id): id is string => Boolean(id)))
  const personKeys = new Set<string>()
  for (const id of personProspects) {
    for (const phone of phonesOf(world)) {
      if (phone.prospectId === id && phoneKey(phone.phone).length === 10) personKeys.add(phoneKey(phone.phone))
    }
  }
  for (const anchor of anchors) personKeys.add(phoneKey(anchor.phone))
  if (!personKeys.has(key) && !phonesOf(world).some((phone) => phone.prospectId && personProspects.has(phone.prospectId) && sameKey(phone.phone, key))) {
    return null
  }
  const focusIds = new Set<string>()
  if (prospectId) focusIds.add(prospectId)
  for (const phone of phonesOf(world)) {
    if (phone.prospectId && sameKey(phone.phone, key) && !(phone.voiceHold === true && fanoutHoldReason(phone.voiceHoldReason))) {
      focusIds.add(phone.prospectId)
    }
  }
  if (focusIds.size === 0) focusIds.add([...personProspects][0] ?? '')
  const anchorProperties = new Set(
    anchors.map((phone) => propertyKey(prospectFor(world, phone.prospectId))).filter((value): value is string => Boolean(value)),
  )
  const samePerson = [...focusIds].some((id) => personProspects.has(id))
  const sameProperty = [...focusIds].some((id) => {
    const value = propertyKey(prospectFor(world, id))
    return Boolean(value && anchorProperties.has(value))
  })
  if (samePerson || sameProperty) return 'person_fanout'
  if (personKeys.has(key)) return 'needs_counsel_review'
  return null
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
    if (phonesOf(world).some((phone) => phone.prospectId === id && !sameKey(phone.phone, key) && mojoRawPerson(world, phone.phone))) {
      return true
    }
  }

  for (const lead of world.leads ?? []) {
    if (!personLevelLead(lead)) continue
    const leadKey = phoneKey(lead.phone)
    if (leadKey.length !== 10 || leadKey === key) continue
    const prospectIds = new Set(
      phonesOf(world).filter((phone) => phone.prospectId && sameKey(phone.phone, leadKey)).map((phone) => phone.prospectId as string),
    )
    if (phonesOf(world).some((phone) => phone.prospectId && prospectIds.has(phone.prospectId) && sameKey(phone.phone, key))) {
      return true
    }
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
      if (suppressionClass('mojo_disposition_raw', other.dispositionRaw) === 'person_dnc') return true
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

function prospectFor(world: SuppressionWorld, id: string | null | undefined): SuppressionProspect | undefined {
  if (!id) return undefined
  return world.prospects?.find((item) => item.id === id)
}

function relationshipForPhone(world: SuppressionWorld, phone: SuppressionPhone): RelationshipBucket {
  return relationshipBucket(phone.relationship, prospectFor(world, phone.prospectId)?.ownerType)
}

function candidatePhones(world: SuppressionWorld, key: string): SuppressionPhone[] {
  return phonesOf(world).filter((phone) => sameKey(phone.phone, key))
}

function roleTokens(value: string | null | undefined): string[] {
  return (labelKey(value) ?? '').split('_').filter(Boolean)
}

function showsRegisteredAgent(phone: SuppressionPhone): boolean {
  return roleTokens(phone.relationship).includes('registered') && roleTokens(`${phone.relationship} ${phone.entityRole ?? ''} ${phone.contactName ?? ''}`).includes('agent')
    || roleTokens(phone.entityRole).join('_') === 'registered_agent'
    || roleTokens(phone.contactName).join('_').includes('registered_agent')
    || (labelKey(phone.relationship) ?? '') === 'registered_agent'
    || (labelKey(phone.entityRole) ?? '') === 'registered_agent'
    || (labelKey(phone.contactName) ?? '').includes('registered_agent')
}

function showsMemberOrOfficer(phone: SuppressionPhone): boolean {
  if (showsRegisteredAgent(phone)) return false
  const tokens = [
    ...roleTokens(phone.relationship),
    ...roleTokens(phone.entityRole),
    ...roleTokens(phone.contactName),
  ]
  return tokens.includes('member') || tokens.includes('officer')
}

function ownerSkipTraceRelease(world: SuppressionWorld, phone: SuppressionPhone): boolean {
  const prospect = prospectFor(world, phone.prospectId)
  const source = labelKey(phone.verifiedSource) ?? ''
  const skipTraced = prospect?.skipTraced === true || source.includes('skip')
  if (!skipTraced) return false
  if (relationshipForPhone(world, phone) === 'owner') return true
  const contact = labelKey(phone.contactName)
  const owner = labelKey(prospect?.ownerName)
  const last = labelKey(prospect?.ownerLast)
  if (!contact) return false
  return contact === owner || contact === last || (last !== null && contact.split('_').includes(last))
}

function relationshipBlock(world: SuppressionWorld, key: string, prospectId?: string | null): 'associate_non_family' | 'relationship_unknown' | null {
  const rows = candidatePhones(world, key).filter((phone) => !prospectId || phone.prospectId === prospectId)
  let unknown = false
  for (const phone of rows) {
    const bucket = relationshipForPhone(world, phone)
    if (bucket === 'owner') continue
    if (bucket === 'associate_non_family') return 'associate_non_family'
    if (bucket !== 'relationship_unknown') continue
    if (ownerSkipTraceRelease(world, phone) || showsMemberOrOfficer(phone)) continue
    unknown = true
  }
  return unknown ? 'relationship_unknown' : null
}

function ownerPhoneHasPropertyDnc(world: SuppressionWorld, ownerKey: string): boolean {
  if (ownerKey.length !== 10) return false
  if (phonesOf(world).some((phone) => sameKey(phone.phone, ownerKey) && PROPERTY_OWNER_DNC.includes(labelKey(phone.lastDisposition) as typeof PROPERTY_OWNER_DNC[number]))) {
    return true
  }
  if ((world.optOuts ?? []).some((row) => row.optedOut !== false && sameKey(row.phone, ownerKey))) return true
  if ((world.mojoEvents ?? []).some((event) => sameKey(event.phone, ownerKey) && labelKey(event.outcome) === 'dnc')) return true
  if ((world.encodePending ?? []).some((phone) => sameKey(phone, ownerKey))) return true
  return false
}

function propertyOwnerDncFanout(world: SuppressionWorld, key: string, prospectId?: string | null): boolean {
  const propertyKeys = new Set<string>()
  for (const id of prospectIdsFor(world, key, prospectId)) {
    const value = propertyKey(prospectFor(world, id))
    if (value) propertyKeys.add(value)
  }
  if (propertyKeys.size === 0) return false
  for (const phone of phonesOf(world)) {
    const prospect = prospectFor(world, phone.prospectId)
    const value = propertyKey(prospect)
    if (!value || !propertyKeys.has(value)) continue
    if (relationshipForPhone(world, phone) !== 'owner') continue
    if (ownerPhoneHasPropertyDnc(world, phoneKey(phone.phone))) return true
  }
  return false
}

function mojoLast4Tied(world: SuppressionWorld, key: string, call: SuppressionMojoCall, prospectId?: string | null): boolean {
  const contact = (call.providerContactId ?? '').trim()
  if (contact && (world.mojoEvents ?? []).some((event) => event.providerContactId === contact && (
    sameKey(event.phone, key) || phonesOf(world).some((phone) => phone.prospectId === prospectId && sameKey(phone.phone, event.phone))
  ))) return true
  if (!call.leadId) return false
  const homes = (world.prospects ?? []).filter((prospect) => prospect.leadId === call.leadId)
  if (homes.some((prospect) => prospect.id === prospectId)) return true
  const keys = new Set(homes.map((prospect) => householdKey(prospect)).filter((value): value is string => Boolean(value)))
  const mineKey = householdKey(prospectFor(world, prospectId))
  return (mineKey !== null && keys.has(mineKey)) || phonesOf(world).some((phone) => sameKey(phone.phone, key) && keys.has(householdKey(prospectFor(world, phone.prospectId)) ?? ''))
}

function serviceSlug(value: string | null | undefined): string | null {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(/\b(county|missouri|kansas|mo|ks)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return slug || null
}

function outOfServiceArea(world: SuppressionWorld): boolean {
  const allowed = new Set(['jackson', 'clay', 'platte', 'johnson', 'wyandotte'])
  return [world.county, world.situsCounty].some((value) => {
    const slug = serviceSlug(value)
    return Boolean(slug && !allowed.has(slug))
  })
}

function shortSuppressionMatch(world: SuppressionWorld, key: string, prospectId?: string | null): boolean {
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
  if ((world.mojoEvents ?? []).some((event) => short(event.phone) && (
    blockingClass('mojo_disposition_raw', event.dispositionRaw) || blockingClass('mojo_outcome', event.outcome)
  ))) return true
  if ((world.mojoCalls ?? []).some((call) => {
    const rawClass = suppressionClass('mojo_disposition_raw', call.resultLabel)
    const dncClass = rawClass === 'mojo_dnc' || rawClass === 'person_dnc' || rawClass === 'disconnected'
    if (call.phoneLast4 !== last4 || !dncClass) return false
    if (call.hasFullPhone === true) return false
    const fullPhone = (world.mojoEvents ?? []).some((event) => (
      call.recordId != null && event.recordId === call.recordId && phoneKey(event.phone).length === 10
    ))
    if (fullPhone) return false
    return mojoLast4Tied(world, key, call, prospectId)
  })) {
    return true
  }
  if ((world.optOuts ?? []).some((row) => row.optedOut !== false && short(row.phone))) return true
  if ((world.encodePending ?? []).some((phone) => short(phone))) return true
  return false
}

const PROSPECT_REASON_ORDER = ['prospect_dnc', 'wrong_number', 'disconnected', 'unmapped_label'] as const
const LEAD_REASON_ORDER = ['lead_dnc', 'dead_number', 'disconnected', 'unmapped_label'] as const
const MOJO_REASON_ORDER = ['mojo_dnc', 'wrong_number', 'disconnected', 'unmapped_label'] as const

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
  if (value === 'mojo_dnc' || value === 'person_dnc') return 'mojo_dnc'
  if (value === 'disconnected') return 'disconnected'
  if (value === 'wrong_number') return 'wrong_number'
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
  if (phonesOf(world).some((row) => row.voiceHold === true && !fanoutHoldReason(row.voiceHoldReason) && sameKey(row.phone, key))) {
    return 'voice_hold'
  }

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
    (world.mojoEvents ?? []).filter((event) => sameKey(event.phone, key)).flatMap((event) => {
      const raw = reasonFromMojoClass(blockingClass('mojo_disposition_raw', event.dispositionRaw) ?? '')
      return raw ? [raw] : [reasonFromMojoClass(blockingClass('mojo_outcome', event.outcome) ?? '')]
    }),
    MOJO_REASON_ORDER,
  )
  if (mojoReason) return mojoReason

  const tie = relationshipBlock(world, key, prospectId)
  if (tie) return tie
  if (propertyOwnerDncFanout(world, key, prospectId)) return 'property_owner_dnc_fanout'
  const held = counselOrPersonHold(world, key, prospectId)
  if (held) return held
  if (personFanout(world, key, prospectId)) return 'person_fanout'
  if (householdFanout(world, key, prospectId)) return 'household_fanout'
  if ((world.encodePending ?? []).some((row) => sameKey(row, key))) return 'mojo_encode_pending'
  if (shortSuppressionMatch(world, key, prospectId)) return 'hold_last4'
  if (outOfServiceArea(world)) return 'out_of_service_area'
  return null
}
