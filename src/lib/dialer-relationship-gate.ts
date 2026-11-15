import { ownerLineRelease } from '@/lib/dialer-owner-line-release'

/**
 * Counsel §4h / §4k relationship gate.
 * Lane and source come from the source list fields only. Titles are ignored.
 * probate/inherited is stricter than a deceased source, which is stricter than tax and every other list.
 */

const FAMILY_POSSIBLE_TYPES = ['parent', 'in_law', 'spouse', 'child', 'sibling', 'other_relative'] as const
const ROLE_WORDS = new Set(['member', 'manager', 'officer'])
const BLOCK_WORDS = new Set([
  'llc', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'trust', 'bank', 'lp', 'llp', 'pllc',
  'holdings', 'ct', 'resident', 'agent', 'pc', 'legal', 'law', 'attorney', 'attorneys', 'lawyer', 'lawyers', 'esq', 'firm',
])

export type LaneClass = 'probate' | 'deceased' | 'open' | 'closed'

const REASON_RANK: Record<string, number> = {
  deceased_owner_line: 88,
  associate: 89,
  associate_non_family: 90,
  relationship_unknown: 91,
  relative_not_allowed: 92,
  dead_manual_review_unread: 76,
  property_owner_dnc_fanout: 99,
  lead_dnc: 70,
}

function labelKey(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return text || null
}

function tokens(value: string | null | undefined): string[] {
  return (labelKey(value) ?? '').split('_').filter(Boolean)
}

function callerLane(key: string): boolean {
  return key.startsWith('tax') || key === 'foreclosure' || key === 'code_violation' || key.startsWith('mls')
    || isDeceasedSource(key) || isProbateOrInherited(key)
}

/** Caller lane (export batch, Mojo list, campaign setting) plus probate/inherited links. Titles are ignored. */
export function sourceListLanes(input: {
  lane?: string | null
  source?: string | null
  lanes?: readonly (string | null | undefined)[]
  linkedLanes?: readonly (string | null | undefined)[]
  title?: string | null
}): string[] {
  void input.title
  const caller = [input.lane, input.source, ...(input.lanes ?? [])]
    .map((value) => labelKey(value))
    .filter((value): value is string => Boolean(value && callerLane(value)))
  const links = (input.linkedLanes ?? [])
    .map((value) => labelKey(value))
    .filter((value): value is string => Boolean(value && isProbateOrInherited(value)))
  return [...caller, ...links]
}

function isProbateOrInherited(key: string): boolean {
  return key === 'probate_estate' || key === 'inherited_deed' || key.startsWith('probate') || key.startsWith('inherited')
}

function isDeceasedSource(key: string): boolean {
  if (key.startsWith('tax') || key.startsWith('non_')) return false
  return key === 'deceased' || key.startsWith('deceased_')
}

/** Probate/inherited wins. No lane fails closed. */
export function laneClass(lanes: readonly (string | null | undefined)[]): LaneClass {
  const keys = lanes.map((value) => labelKey(value)).filter((value): value is string => Boolean(value))
  if (keys.length === 0) return 'closed'
  if (keys.some(isProbateOrInherited)) return 'probate'
  if (keys.some(isDeceasedSource)) return 'deceased'
  return 'open'
}

export function worstBlockReason(reasons: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null
  let rank = Number.POSITIVE_INFINITY
  for (const reason of reasons) {
    if (!reason) continue
    const next = REASON_RANK[reason] ?? 200
    if (next < rank) { best = reason; rank = next }
  }
  return best
}

export function isFamilyPossibleType(ownerType: string | null | undefined): boolean {
  const owner = labelKey(ownerType)
  return Boolean(owner && (FAMILY_POSSIBLE_TYPES as readonly string[]).includes(owner))
}

function showsRegisteredAgent(input: { relationship?: string | null; contactName?: string | null; entityRole?: string | null }): boolean {
  const rel = labelKey(input.relationship) ?? ''
  const role = labelKey(input.entityRole) ?? ''
  const contact = labelKey(input.contactName) ?? ''
  return rel === 'registered_agent' || role === 'registered_agent' || contact === 'registered_agent' || contact.includes('registered_agent')
    || (tokens(input.relationship).includes('registered') && tokens(`${input.relationship} ${input.entityRole ?? ''} ${input.contactName ?? ''}`).includes('agent'))
}

function isLawFirm(contactName: string | null | undefined, ownerName: string | null | undefined): boolean {
  const joined = `${labelKey(contactName) ?? ''} ${labelKey(ownerName) ?? ''}`
  if (/law_firm|ct_corporation|resident_agent/.test(joined)) return true
  return tokens(`${contactName ?? ''} ${ownerName ?? ''}`).some((token) => BLOCK_WORDS.has(token) && ['law', 'attorney', 'attorneys', 'lawyer', 'lawyers', 'esq', 'firm', 'legal', 'llp', 'pc'].includes(token))
}

function isCompanyItself(contactName: string | null | undefined, ownerName: string | null | undefined): boolean {
  const contact = labelKey(contactName)
  const owner = labelKey(ownerName)
  if (contact && owner && contact === owner) return true
  const nameTokens = tokens(contactName)
  return nameTokens.length > 0 && nameTokens.every((token) => BLOCK_WORDS.has(token))
}

function hasEntityRole(input: { relationship?: string | null; contactName?: string | null; entityRole?: string | null }): boolean {
  return [...tokens(input.relationship), ...tokens(input.entityRole), ...tokens(input.contactName)]
    .some((token) => ROLE_WORDS.has(token))
}

function personNameTokens(contactName: string | null | undefined): string[] {
  return tokens(contactName).filter((token) => token.length > 1 && !ROLE_WORDS.has(token) && !BLOCK_WORDS.has(token))
}

function qualifyingEntitySkip(verifiedSource: string | null | undefined, skipTraced: boolean | null | undefined): boolean {
  if (skipTraced !== true) return false
  const source = String(verifiedSource ?? '').trim().toLowerCase()
  return /^dataskip_run/.test(source) || /^smartskip_/.test(source)
}

function sosFiling(verifiedSource: string | null | undefined): boolean {
  const source = String(verifiedSource ?? '').trim().toLowerCase()
  return /sos|secretary_of_state|articles_of_org/.test(source)
}

/** Named member, manager, or officer. SOS filing or an entity skip trace. Never on probate/inherited or a deceased source. */
export function entityContactReleased(input: {
  relationship?: string | null
  contactName?: string | null
  entityRole?: string | null
  ownerName?: string | null
  verifiedSource?: string | null
  skipTraced?: boolean | null
  lanes?: readonly (string | null | undefined)[]
}): boolean {
  const lane = laneClass(input.lanes ?? [])
  if (lane === 'probate' || lane === 'deceased' || lane === 'closed') return false
  if (showsRegisteredAgent(input) || isLawFirm(input.contactName, input.ownerName) || isCompanyItself(input.contactName, input.ownerName)) return false
  if (!hasEntityRole(input) || personNameTokens(input.contactName).length < 2) return false
  return sosFiling(input.verifiedSource) || qualifyingEntitySkip(input.verifiedSource, input.skipTraced)
}

function nameTokens(value: string | null | undefined): string[] {
  return String(value ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean)
}

function ownerNameMatch(contactName: string | null | undefined, ownerName: string | null | undefined, ownerFirst: string | null | undefined, ownerLast: string | null | undefined): boolean {
  const contact = labelKey(contactName)
  const owner = labelKey(ownerName)
  if (contact && owner && contact === owner) return true
  const first = labelKey(ownerFirst)
  const last = labelKey(ownerLast)
  const parts = nameTokens(contactName)
  if (first && last && parts.includes(first) && parts.includes(last)) return true
  const shared = nameTokens(ownerName).filter((token) => parts.includes(token))
  return Boolean(last && shared.length >= 2 && shared.includes(last))
}

export function deceasedOwnerLine(input: {
  relationship?: string | null
  contactName?: string | null
  ownerName?: string | null
  ownerFirst?: string | null
  ownerLast?: string | null
  deceased?: boolean | null
}): boolean {
  const rel = labelKey(input.relationship)
  if (rel === 'decedent' || rel === 'deceased_owner_line' || tokens(input.contactName).includes('decedent')) return true
  return (rel === 'owner' || rel === 'subject') && input.deceased === true
    && ownerNameMatch(input.contactName, input.ownerName, input.ownerFirst, input.ownerLast)
}

const SPECIFIC_RELATIVES = ['spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative'] as const
const RECOGNISED = new Set<string>([
  'owner', 'subject', 'co_owner', 'personal_representative', 'pr', 'personal_rep', 'on_title', 'on_title_owner',
  'relative', ...SPECIFIC_RELATIVES, 'associate', 'entity_contact', 'unknown', 'deceased_owner_line',
  'neighbor', 'coworker', 'past_neighbor', 'friend', 'landlord', 'tenant',
])
const ASSOCIATE_TYPES = new Set(['neighbor', 'coworker', 'past_neighbor', 'friend', 'landlord', 'tenant'])
const ON_TITLE = new Set(['owner', 'subject', 'co_owner', 'personal_representative', 'pr', 'personal_rep', 'on_title', 'on_title_owner'])

export type GateBucket = 'owner' | 'relative' | 'associate_non_family' | 'relationship_unknown'

export function counselRelationshipBucket(relationship: string | null | undefined, ownerType: string | null | undefined): GateBucket {
  const rel = labelKey(relationship)
  const owner = labelKey(ownerType)
  if (rel === 'associate' || (owner !== null && ASSOCIATE_TYPES.has(owner))) return 'associate_non_family'
  if (rel !== null && ON_TITLE.has(rel)) return 'owner'
  if (rel === 'relative') return 'relative'
  if (rel === 'unknown' || rel === 'entity_contact' || owner === 'unknown') return 'relationship_unknown'
  if (rel !== null && !RECOGNISED.has(rel)) return 'relationship_unknown'
  if ((rel !== null && (SPECIFIC_RELATIVES as readonly string[]).includes(rel)) || isFamilyPossibleType(owner)) return 'relative'
  return 'relationship_unknown'
}

interface GatePhone {
  phone: string
  prospectId?: string | null
  relationship?: string | null
  contactName?: string | null
  verifiedSource?: string | null
  entityRole?: string | null
  lastDisposition?: string | null
  voiceHold?: boolean | null
}

interface GateProspect {
  id: string
  ownerType?: string | null
  ownerName?: string | null
  ownerLast?: string | null
  skipTraced?: boolean | null
  parcelId?: string | null
  county?: string | null
  street?: string | null
  zip?: string | null
  deceased?: boolean | null
  ownerFirst?: string | null
  leadId?: string | null
}

export function askOffText(value: string | null | undefined): boolean {
  const text = `${labelKey(value) ?? ''} ${String(value ?? '').toLowerCase()}`
  return /\b(dnc|dnc_refused|do_not_call|stop|refus|take_me_off|do_not_contact)\b/.test(text)
}

export function counselDeadLead(leads: readonly { phone?: string | null; deadReason?: string | null; notes?: string | null; station?: string | null; classification?: string | null }[] | undefined, key: string, samePhone: (phone: string, key: string) => boolean): 'lead_dnc' | 'dead_manual_review_unread' | null {
  for (const lead of leads ?? []) {
    if (!lead.phone || !samePhone(lead.phone, key)) continue
    const dead = labelKey(lead.station) === 'dead' || labelKey(lead.classification) === 'dead' || Boolean(String(lead.deadReason ?? '').trim())
    if (!dead) continue
    if (askOffText(lead.deadReason) || askOffText(lead.notes)) return 'lead_dnc'
    return 'dead_manual_review_unread'
  }
  return null
}

function strictLane(lanes: readonly (string | null | undefined)[]): boolean {
  const lane = laneClass(lanes)
  return lane === 'probate' || lane === 'closed'
}

function familyKind(relationship: string | null | undefined, ownerType: string | null | undefined): string | null {
  const rel = labelKey(relationship)
  const owner = labelKey(ownerType)
  if (rel === 'relative') return 'other_relative'
  if (rel && (SPECIFIC_RELATIVES as readonly string[]).includes(rel)) return rel
  if (!rel && isFamilyPossibleType(owner)) return owner
  return null
}

export function counselRelationshipBlock(input: {
  key: string
  prospectId?: string | null
  lanes: readonly (string | null | undefined)[]
  phones: readonly GatePhone[]
  prospects: readonly GateProspect[]
  samePhone: (phone: string, key: string) => boolean
}): 'associate' | 'associate_non_family' | 'relative_not_allowed' | 'relationship_unknown' | 'deceased_owner_line' | null {
  const prospectFor = (id: string | null | undefined) => input.prospects.find((item) => item.id === id)
  const rows = input.phones.filter((phone) => input.samePhone(phone.phone, input.key) && (!input.prospectId || phone.prospectId === input.prospectId))
  const lanes = input.lanes
  const found: string[] = []
  for (const phone of rows) {
    const rel = labelKey(phone.relationship)
    const prospect = prospectFor(phone.prospectId)
    const release = () => ownerLineRelease({
      relationship: phone.relationship, contactName: phone.contactName, ownerName: prospect?.ownerName,
      ownerLast: prospect?.ownerLast, ownerType: prospect?.ownerType, skipTraced: prospect?.skipTraced, verifiedSource: phone.verifiedSource,
    })
    if (deceasedOwnerLine({
      relationship: phone.relationship, contactName: phone.contactName, ownerName: prospect?.ownerName,
      ownerFirst: prospect?.ownerFirst, ownerLast: prospect?.ownerLast, deceased: prospect?.deceased,
    })) { found.push('deceased_owner_line'); continue }
    if (rel === 'associate') {
      const ownerHere = Boolean(input.prospectId) && rows.some((row) => row.prospectId === input.prospectId && ON_TITLE.has(labelKey(row.relationship) ?? ''))
      if (!ownerHere) found.push('associate')
      continue
    }
    const bucket = counselRelationshipBucket(phone.relationship, prospect?.ownerType)
    if (bucket === 'owner') continue
    if (bucket === 'associate_non_family') {
      if (showsRegisteredAgent(phone) || !release()) found.push('associate_non_family')
      continue
    }
    if (rel === 'entity_contact' || showsRegisteredAgent(phone)) {
      const released = rel === 'entity_contact' && entityContactReleased({
        relationship: phone.relationship, contactName: phone.contactName, entityRole: phone.entityRole,
        ownerName: prospect?.ownerName, verifiedSource: phone.verifiedSource, skipTraced: prospect?.skipTraced, lanes,
      })
      if (!released) found.push('relationship_unknown')
      continue
    }
    if (bucket === 'relative' && strictLane(lanes)) {
      const kind = familyKind(phone.relationship, prospect?.ownerType)
      if (kind === 'parent' || kind === 'in_law' || kind === 'other_relative') found.push('relative_not_allowed')
      continue
    }
    if (bucket !== 'relationship_unknown') continue
    if (rel !== null && rel !== 'unknown') { found.push('relationship_unknown'); continue }
    if (!release()) found.push('relationship_unknown')
  }
  return worstBlockReason(found) as 'associate' | 'associate_non_family' | 'relative_not_allowed' | 'relationship_unknown' | 'deceased_owner_line' | null
}

export function counselRelativeOwnerDnc(input: {
  key: string
  prospectId?: string | null
  phones: readonly GatePhone[]
  prospects: readonly GateProspect[]
  optOuts?: readonly { phone: string; optedOut?: boolean | null }[]
  leads?: readonly { id?: string; phone?: string | null; deadReason?: string | null; notes?: string | null }[]
  samePhone: (phone: string, key: string) => boolean
  propertyOf: (prospect: GateProspect | null | undefined) => string | null
}): boolean {
  const prospectFor = (id: string | null | undefined) => input.prospects.find((item) => item.id === id)
  const targets = input.phones.filter((phone) => input.samePhone(phone.phone, input.key) && (!input.prospectId || phone.prospectId === input.prospectId))
  if (!targets.some((phone) => counselRelationshipBucket(phone.relationship, prospectFor(phone.prospectId)?.ownerType) === 'relative')) return false
  const prospectIds = new Set(targets.map((phone) => phone.prospectId).filter((id): id is string => Boolean(id)))
  const properties = new Set([...prospectIds].map((id) => input.propertyOf(prospectFor(id))).filter((value): value is string => Boolean(value)))
  for (const phone of input.phones) {
    if (input.samePhone(phone.phone, input.key)) continue
    const ownerRel = labelKey(phone.relationship)
    if (ownerRel !== 'owner' && ownerRel !== 'subject' && ownerRel !== 'co_owner') continue
    const samePerson = Boolean(phone.prospectId && prospectIds.has(phone.prospectId))
    const property = input.propertyOf(prospectFor(phone.prospectId))
    if (!samePerson && !(property && properties.has(property))) continue
    const disposition = labelKey(phone.lastDisposition)
    if (disposition === 'dnc' || disposition === 'do_not_call' || disposition === 'dnc_number' || disposition === 'dnc_contact' || disposition === 'take_me_off') return true
    if (phone.voiceHold === true) return true
    if ((input.optOuts ?? []).some((row) => row.optedOut !== false && input.samePhone(row.phone, phone.phone))) return true
  }
  const leadIds = new Set(targets.map((phone) => prospectFor(phone.prospectId)?.leadId).filter((id): id is string => Boolean(id)))
  return (input.leads ?? []).some((lead) => Boolean(lead.id && leadIds.has(lead.id) && (askOffText(lead.deadReason) || askOffText(lead.notes))))
}

interface CampaignPhone extends GatePhone {
  ownerType?: string | null
  ownerName?: string | null
  ownerLast?: string | null
  skipTraced?: boolean | null
}

export function campaignMemberOffered(input: {
  status: string
  lane?: string | null
  source?: string | null
  lanes?: readonly (string | null)[]
  title?: string | null
  phones: readonly CampaignPhone[]
}, block: (phone: string, world: { lane?: string | null; source?: string | null; lanes?: readonly (string | null)[]; listTitle?: string | null; prospects: GateProspect[]; phones: GatePhone[] }, prospectId: string) => string | null): boolean {
  if (input.status !== 'active') return false
  return input.phones.some((phone) => block(phone.phone, {
    lane: input.lane, source: input.source, lanes: input.lanes, listTitle: input.title,
    prospects: [{ id: 'member', ownerType: phone.ownerType, ownerName: phone.ownerName, ownerLast: phone.ownerLast, skipTraced: phone.skipTraced }],
    phones: [{ ...phone, prospectId: 'member' }],
  }, 'member') === null)
}
