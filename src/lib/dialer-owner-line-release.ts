/**
 * A person named on the owner line is an owner.
 * The release lifts only associate_non_family / relationship_unknown.
 * Keep the nickname pairs and the SQL function dialer_owner_line_release_v1 in lockstep.
 */

export const OWNER_LINE_NICKNAMES: ReadonlyArray<readonly [string, string]> = [
  ['bill', 'william'],
  ['billy', 'william'],
  ['will', 'william'],
  ['bob', 'robert'],
  ['rob', 'robert'],
  ['bobby', 'robert'],
  ['liz', 'elizabeth'],
  ['beth', 'elizabeth'],
  ['betty', 'elizabeth'],
  ['jim', 'james'],
  ['jimmy', 'james'],
  ['joe', 'joseph'],
  ['joey', 'joseph'],
  ['tom', 'thomas'],
  ['tommy', 'thomas'],
  ['mike', 'michael'],
  ['dave', 'david'],
  ['dan', 'daniel'],
  ['danny', 'daniel'],
  ['chris', 'christopher'],
  ['matt', 'matthew'],
  ['tony', 'anthony'],
  ['steve', 'steven'],
  ['steve', 'stephen'],
  ['chuck', 'charles'],
  ['charlie', 'charles'],
  ['jack', 'john'],
  ['johnny', 'john'],
  ['kate', 'katherine'],
  ['kathy', 'katherine'],
  ['katie', 'katherine'],
  ['cathy', 'katherine'],
  ['rick', 'richard'],
  ['rich', 'richard'],
  ['dick', 'richard'],
]

const ENTITY_WORDS = new Set([
  'llc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'trust',
  'bank',
  'company',
  'llp',
  'pllc',
  'lp',
])

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'junior', 'senior'])

export interface OwnerLineReleaseInput {
  relationship?: string | null
  contactName?: string | null
  ownerName?: string | null
  ownerLast?: string | null
  skipTraced?: boolean | null
  verifiedSource?: string | null
}

interface Person {
  first: string
  middles: string[]
  last: string | null
}

function tokensOf(value: string | null | undefined): string[] {
  return String(value ?? '')
    .toLowerCase()
    .replace(/l\.l\.c\.?/g, ' llc ')
    .replace(/&/g, ' & ')
    .replace(/[^a-z0-9&-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => Boolean(token) && token !== '&')
}

function isInitial(token: string): boolean {
  return token.length === 1
}

function isTrusteeToken(token: string): boolean {
  return token === 'trustee' || token === 'trustees' || token.endsWith('-trustee') || token.endsWith('-trustees')
}

function stripSuffix(tokens: string[]): string[] {
  const copy = [...tokens]
  while (copy.length > 1 && SUFFIXES.has(copy[copy.length - 1] ?? '')) copy.pop()
  return copy
}

function hasBlockedMarker(value: string): boolean {
  const text = value.toLowerCase().replace(/\s+/g, ' ')
  return /\bet\s+al\b/.test(text)
    || /\bheirs\s+of\b/.test(text)
    || /\bestate\s+of\b/.test(text)
    || /\bdeceased\b/.test(text)
    || /\bc\s*\/\s*o\b/.test(text)
}

function isRegisteredAgent(relationship?: string | null, contactName?: string | null): boolean {
  const rel = String(relationship ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const contact = String(contactName ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return rel === 'registered_agent' || contact === 'registered_agent' || contact.includes('registered_agent')
}

function skipReturned(skipTraced?: boolean | null, verifiedSource?: string | null): boolean {
  return skipTraced === true || String(verifiedSource ?? '').toLowerCase().includes('skip')
}

function sameFirst(left: string, right: string): boolean {
  if (left === right) return true
  return OWNER_LINE_NICKNAMES.some(([short, full]) => (
    (left === short && right === full) || (left === full && right === short)
  ))
}

function lastNamesMatch(personLast: string, contactTokens: string[]): boolean {
  const last = contactTokens[contactTokens.length - 1]
  if (last === personLast) return true
  if (!personLast.includes('-')) return false
  const parts = personLast.split('-').filter(Boolean)
  if (parts.length < 2 || contactTokens.length < parts.length) return false
  return contactTokens.slice(-parts.length).join('-') === personLast
}

function nameWords(segment: string): string[] {
  const tokens = tokensOf(segment)
  const trusteeAt = tokens.findIndex((token) => isTrusteeToken(token))
  const kept = trusteeAt >= 0 ? tokens.slice(0, trusteeAt) : tokens
  return kept.filter((token) => !isTrusteeToken(token))
}

function segmentIsEntity(segment: string): boolean {
  return tokensOf(segment).some((token) => ENTITY_WORDS.has(token))
}

function segmentIsTrustee(segment: string): boolean {
  return tokensOf(segment).some((token) => isTrusteeToken(token))
}

function lastHint(ownerLast: string | null | undefined, lineTokens: string[]): string | null {
  const tokens = stripSuffix(tokensOf(ownerLast))
  const last = tokens[tokens.length - 1]
  if (!last || isInitial(last) || ENTITY_WORDS.has(last)) return null
  return lineTokens.includes(last) ? last : null
}

function isCountyLine(firstTokens: string[], hint: string | null): boolean {
  const tokens = stripSuffix(firstTokens)
  if (tokens.length === 0) return false
  if (hint && tokens[0] === hint) return true
  return tokens.length >= 3 && isInitial(tokens[tokens.length - 1] ?? '') && !isInitial(tokens[0] ?? '')
}

function parseCountySegment(tokens: string[], hint: string | null): Person[] {
  const stripped = stripSuffix(tokens)
  const nonInitial = stripped.filter((token) => !isInitial(token))
  if (nonInitial.length === 0) return []
  if (nonInitial.length === 1 || isInitial(stripped[0] ?? '')) {
    const first = nonInitial[0] ?? ''
    return [{ first, middles: stripped.filter((token) => token !== first), last: null }]
  }
  const forceLastFirst = (hint !== null && stripped[0] === hint)
    || stripped.some((token) => isInitial(token))
    || nonInitial.length >= 3
  if (forceLastFirst && !isInitial(stripped[0] ?? '')) {
    const last = stripped[0] ?? ''
    const rest = stripped.slice(1)
    const first = rest.find((token) => !isInitial(token)) ?? ''
    if (!first) return []
    return [{ first, middles: rest.filter((token) => token !== first), last }]
  }
  return [
    { first: stripped[0] ?? '', middles: stripped.slice(1), last: null },
    { first: stripped[1] ?? '', middles: [], last: stripped[0] ?? null },
  ]
}

function parseNaturalSegment(tokens: string[]): Person[] {
  const stripped = stripSuffix(tokens)
  const nonInitial = stripped.filter((token) => !isInitial(token))
  if (nonInitial.length === 0) return []
  if (nonInitial.length === 1) {
    const first = nonInitial[0] ?? ''
    return [{ first, middles: stripped.filter((token) => isInitial(token)), last: null }]
  }
  const last = nonInitial[nonInitial.length - 1] ?? ''
  const given = nonInitial.slice(0, -1)
  const first = given[0] ?? ''
  return [{
    first,
    middles: [...given.slice(1), ...stripped.filter((token) => isInitial(token))],
    last,
  }]
}

function assignLastNames(people: Person[]): Person[] {
  let carried: string | null = null
  for (const person of people) {
    if (person.last) carried = person.last
    else if (carried) person.last = carried
  }
  let upcoming: string | null = null
  for (let index = people.length - 1; index >= 0; index -= 1) {
    const person = people[index]
    if (!person) continue
    if (person.last) upcoming = person.last
    else if (upcoming) person.last = upcoming
  }
  return people.filter((person) => person.first && person.last)
}

function ownerPersons(ownerName: string, ownerLast?: string | null): Person[] {
  const segments = ownerName.split('&').map((part) => part.trim()).filter(Boolean)
  const lineTokens = tokensOf(ownerName)
  const hint = lastHint(ownerLast, lineTokens)
  const people: Person[] = []
  const county = isCountyLine(nameWords(segments[0] ?? ''), hint)
  for (const segment of segments) {
    if (segmentIsEntity(segment) && !segmentIsTrustee(segment)) continue
    const words = nameWords(segment)
    if (words.length === 0) continue
    people.push(...(county ? parseCountySegment(words, hint) : parseNaturalSegment(words)))
  }
  return assignLastNames(people)
}

function contactMatches(people: Person[], contactName: string, skip: boolean): boolean {
  const tokens = stripSuffix(tokensOf(contactName))
  if (tokens.length < 2) return false
  const last = tokens[tokens.length - 1]
  if (!last || isInitial(last)) return false
  const given = tokens.slice(0, -1).filter((token) => !isInitial(token))
  const first = given[0]
  if (!first) return false
  return people.some((person) => {
    if (!person.last || !lastNamesMatch(person.last, tokens)) return false
    if (sameFirst(person.first, first)) return true
    return skip && person.middles.some((middle) => !isInitial(middle) && sameFirst(middle, first))
  })
}

export function ownerLineRelease(input: OwnerLineReleaseInput): boolean {
  if (isRegisteredAgent(input.relationship, input.contactName)) return false
  const ownerName = String(input.ownerName ?? '').trim()
  const contactName = String(input.contactName ?? '').trim()
  if (!ownerName || !contactName) return false
  if (hasBlockedMarker(ownerName) || hasBlockedMarker(contactName)) return false
  return contactMatches(
    ownerPersons(ownerName, input.ownerLast),
    contactName,
    skipReturned(input.skipTraced, input.verifiedSource),
  )
}
