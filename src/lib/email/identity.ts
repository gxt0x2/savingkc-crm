import { domainToASCII } from 'node:url'

export type IdentityState = 'unresolved' | 'confirmed' | 'conflicting' | 'shared'
export type PartyAddressRelationship = 'confirmed' | 'candidate' | 'shared'

export interface IdentityLink {
  partyId: string
  addressId: string
  normalizedAddress: string
  relationship: PartyAddressRelationship
}

export interface IdentityResolution {
  state: IdentityState
  normalizedAddress: string | null
  partyId: string | null
  candidatePartyIds: string[]
  reason: 'invalid_address' | 'no_match' | 'case_variant' | 'candidate' | 'confirmed' | 'shared' | 'conflicting'
}

/**
 * Preserve the local-part exactly (including dots and plus tags). Domains are
 * IDNA-normalized and lowercased because they are DNS identifiers.
 */
export function normalizeEmailAddress(rawAddress: string): string | null {
  const value = rawAddress.trim()
  const separator = value.lastIndexOf('@')
  if (separator <= 0 || separator !== value.indexOf('@') || separator === value.length - 1) return null
  const local = value.slice(0, separator)
  const domain = domainToASCII(value.slice(separator + 1).replace(/\.$/, ''))
  if (!local || !domain || /\s/.test(local) || /\s/.test(domain)) return null
  return `${local}@${domain.toLowerCase()}`
}

function uniqueIds(links: IdentityLink[]) { return [...new Set(links.map((link) => link.partyId))] }
function caseFold(address: string) { return address.toLocaleLowerCase('en-US') }

/**
 * A resolver is intentionally conservative: a case-only match, a candidate,
 * or a shared mailbox never selects a party for a campaign or thread.
 */
export function resolveEmailIdentity(rawAddress: string, links: IdentityLink[]): IdentityResolution {
  const normalizedAddress = normalizeEmailAddress(rawAddress)
  if (!normalizedAddress) return { state: 'unresolved', normalizedAddress: null, partyId: null, candidatePartyIds: [], reason: 'invalid_address' }
  const exact = links.filter((link) => link.normalizedAddress === normalizedAddress)
  if (exact.length === 0) {
    const caseVariant = links.filter((link) => caseFold(link.normalizedAddress) === caseFold(normalizedAddress))
    return caseVariant.length > 0
      ? { state: 'unresolved', normalizedAddress, partyId: null, candidatePartyIds: uniqueIds(caseVariant), reason: 'case_variant' }
      : { state: 'unresolved', normalizedAddress, partyId: null, candidatePartyIds: [], reason: 'no_match' }
  }
  const confirmed = exact.filter((link) => link.relationship === 'confirmed')
  const shared = exact.filter((link) => link.relationship === 'shared')
  const confirmedPartyIds = uniqueIds(confirmed)
  if (shared.length > 0 || confirmedPartyIds.length > 1) return { state: 'shared', normalizedAddress, partyId: null, candidatePartyIds: uniqueIds([...confirmed, ...shared]), reason: 'shared' }
  if (confirmedPartyIds.length === 1) return { state: 'confirmed', normalizedAddress, partyId: confirmedPartyIds[0], candidatePartyIds: confirmedPartyIds, reason: 'confirmed' }
  const candidates = uniqueIds(exact)
  return { state: candidates.length > 1 ? 'conflicting' : 'unresolved', normalizedAddress, partyId: null, candidatePartyIds: candidates, reason: candidates.length > 1 ? 'conflicting' : 'candidate' }
}

/** Only confirmed aliases participate in party-wide suppression checks. */
export function confirmedAliasAddressIds(partyId: string, links: IdentityLink[]): string[] {
  return [...new Set(links.filter((link) => link.partyId === partyId && link.relationship === 'confirmed').map((link) => link.addressId))]
}
