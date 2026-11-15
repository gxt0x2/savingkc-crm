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
