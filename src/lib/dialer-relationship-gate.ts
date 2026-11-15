import { ownerLineRelease } from '@/lib/dialer-owner-line-release'

/**
 * Counsel §4h / §4k relationship gate.
 * Lane and source come from the source list fields only. Titles are ignored.
 * probate/inherited is stricter than a deceased source, which is stricter than tax and every other list.
 */

const FAMILY_POSSIBLE_TYPES = ['parent', 'in_law', 'spouse', 'child', 'sibling', 'other_relative'] as const
const ROLE_WORDS = new Set(['member', 'manager', 'officer'])
const ENTITY_WORDS = new Set(['llc', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'trust', 'bank', 'lp', 'llp', 'pllc'])
const LAW_WORDS = new Set(['law', 'attorney', 'attorneys', 'lawyer', 'lawyers', 'esq', 'firm'])

export type LaneClass = 'probate' | 'deceased' | 'open'

function labelKey(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return text || null
}

function tokens(value: string | null | undefined): string[] {
  return (labelKey(value) ?? '').split('_').filter(Boolean)
}

/** Titles are not lanes. Only the list lane and source field count. */
export function sourceListLanes(input: {
  lane?: string | null
  source?: string | null
  lanes?: readonly (string | null | undefined)[]
  title?: string | null
}): string[] {
  void input.title
  return [input.lane, input.source, ...(input.lanes ?? [])]
    .map((value) => labelKey(value))
    .filter((value): value is string => Boolean(value))
}

function isProbateOrInherited(key: string): boolean {
  return key === 'probate_estate' || key === 'inherited_deed' || key.startsWith('probate') || key.startsWith('inherited')
}

function isDeceasedSource(key: string): boolean {
  if (key.startsWith('tax') || key.startsWith('non_')) return false
  return key === 'deceased' || key.startsWith('deceased_')
}

/** Several matching lanes: probate/inherited beats a deceased source, which beats tax and every other list. */
export function laneClass(lanes: readonly (string | null | undefined)[]): LaneClass {
  const keys = lanes.map((value) => labelKey(value)).filter((value): value is string => Boolean(value))
  if (keys.some(isProbateOrInherited)) return 'probate'
  if (keys.some(isDeceasedSource)) return 'deceased'
  return 'open'
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
  const contact = tokens(contactName)
  const owner = tokens(ownerName)
  const joined = `${labelKey(contactName) ?? ''} ${labelKey(ownerName) ?? ''}`
  if (joined.includes('law_firm')) return true
  return contact.some((token) => LAW_WORDS.has(token)) || owner.some((token) => LAW_WORDS.has(token))
}

function isCompanyItself(contactName: string | null | undefined, ownerName: string | null | undefined): boolean {
  const contact = labelKey(contactName)
  const owner = labelKey(ownerName)
  if (contact && owner && contact === owner) return true
  const nameTokens = tokens(contactName)
  return nameTokens.length > 0 && nameTokens.every((token) => ENTITY_WORDS.has(token))
}

function hasEntityRole(input: { relationship?: string | null; contactName?: string | null; entityRole?: string | null }): boolean {
  return [...tokens(input.relationship), ...tokens(input.entityRole), ...tokens(input.contactName)]
    .some((token) => ROLE_WORDS.has(token))
}

function isNamedPerson(contactName: string | null | undefined): boolean {
  return tokens(contactName).some((token) => token.length > 1 && !ROLE_WORDS.has(token) && !ENTITY_WORDS.has(token) && !LAW_WORDS.has(token))
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
  if (laneClass(input.lanes ?? []) !== 'open') return false
  if (showsRegisteredAgent(input) || isLawFirm(input.contactName, input.ownerName) || isCompanyItself(input.contactName, input.ownerName)) return false
  if (!hasEntityRole(input) || !isNamedPerson(input.contactName)) return false
  return sosFiling(input.verifiedSource) || qualifyingEntitySkip(input.verifiedSource, input.skipTraced)
}

export function deceasedOwnerLine(relationship: string | null | undefined, ownerType: string | null | undefined): boolean {
  return labelKey(relationship) === 'deceased_owner_line' || labelKey(ownerType) === 'deceased_owner_line'
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
  if (rel === 'unknown' || rel === 'entity_contact' || owner === 'unknown' || deceasedOwnerLine(rel, owner)) return 'relationship_unknown'
  if (rel !== null && !RECOGNISED.has(rel)) return 'relationship_unknown'
  if (rel === 'relative') return isFamilyPossibleType(owner) ? 'relative' : 'relationship_unknown'
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
}

function familyKind(relationship: string | null | undefined, ownerType: string | null | undefined): string | null {
  const rel = labelKey(relationship)
  const owner = labelKey(ownerType)
  if (rel && (SPECIFIC_RELATIVES as readonly string[]).includes(rel)) return rel
  if ((rel === 'relative' || !rel) && isFamilyPossibleType(owner)) return owner
  return null
}

function nameTokens(value: string | null | undefined): string[] {
  return (labelKey(value) ?? '').replace(/[^a-z0-9]+/g, '_').split('_').filter(Boolean)
}

function showsMemberOrOfficer(phone: GatePhone): boolean {
  if (showsRegisteredAgent(phone)) return false
  return [...tokens(phone.relationship), ...tokens(phone.entityRole), ...tokens(phone.contactName)]
    .some((token) => token === 'member' || token === 'officer')
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
  const ownerOnThisNumber = !input.prospectId && input.phones.some((phone) => input.samePhone(phone.phone, input.key) && ON_TITLE.has(labelKey(phone.relationship) ?? ''))
  const lanes = input.lanes
  let unknown = false
  for (const phone of rows) {
    const rel = labelKey(phone.relationship)
    const prospect = prospectFor(phone.prospectId)
    const release = () => ownerLineRelease({
      relationship: phone.relationship, contactName: phone.contactName, ownerName: prospect?.ownerName,
      ownerLast: prospect?.ownerLast, ownerType: prospect?.ownerType, skipTraced: prospect?.skipTraced, verifiedSource: phone.verifiedSource,
    })
    if (deceasedOwnerLine(phone.relationship, prospect?.ownerType)) return 'deceased_owner_line'
    if (rel === 'associate') {
      if (ownerOnThisNumber) continue
      return 'associate'
    }
    const bucket = counselRelationshipBucket(phone.relationship, prospect?.ownerType)
    if (bucket === 'owner') continue
    if (bucket === 'associate_non_family') {
      if (showsRegisteredAgent(phone) || !release()) return 'associate_non_family'
      continue
    }
    if (rel === 'entity_contact' || showsRegisteredAgent(phone)) {
      const released = rel === 'entity_contact' && entityContactReleased({
        relationship: phone.relationship, contactName: phone.contactName, entityRole: phone.entityRole,
        ownerName: prospect?.ownerName, verifiedSource: phone.verifiedSource, skipTraced: prospect?.skipTraced, lanes,
      })
      if (!released) unknown = true
      continue
    }
    if (bucket === 'relative' && laneClass(lanes) === 'probate') {
      const kind = familyKind(phone.relationship, prospect?.ownerType)
      if (kind === 'parent' || kind === 'in_law' || kind === 'other_relative') return 'relative_not_allowed'
      continue
    }
    if (bucket !== 'relationship_unknown') continue
    if (rel === 'relative') {
      if (release()) continue
      unknown = true
      continue
    }
    if (rel !== null && rel !== 'unknown') { unknown = true; continue }
    const last = labelKey(prospect?.ownerLast)
    const first = nameTokens(prospect?.ownerName).find((token) => token !== last)
    const contact = nameTokens(phone.contactName)
    const source = labelKey(phone.verifiedSource) ?? ''
    const skip = prospect?.skipTraced === true || source.includes('skip')
    const skipMatch = skip && Boolean(last && first && contact.includes(first) && contact.includes(last))
    if (skipMatch || showsMemberOrOfficer(phone) || release()) continue
    unknown = true
  }
  return unknown ? 'relationship_unknown' : null
}

export function counselRelativeOwnerDnc(input: {
  key: string
  prospectId?: string | null
  phones: readonly GatePhone[]
  prospects: readonly GateProspect[]
  optOuts?: readonly { phone: string; optedOut?: boolean | null }[]
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
  return false
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
