import { describe, expect, it } from 'vitest'
import { confirmedAliasAddressIds, normalizeEmailAddress, resolveEmailIdentity } from '../identity'

describe('Email identity normalization', () => {
  it('preserves local dots and plus aliases while normalizing an IDNA domain', () => {
    expect(normalizeEmailAddress('  Kim.Seller+Oak@BÜCHER.example. ')).toBe('Kim.Seller+Oak@xn--bcher-kva.example')
  })
  it('does not accept malformed address input', () => {
    expect(normalizeEmailAddress('seller@@example.com')).toBeNull()
  })
})

describe('Email identity resolution', () => {
  it('requires explicit resolution for a local-part case variant', () => {
    expect(resolveEmailIdentity('seller@example.com', [{ partyId: 'party-a', addressId: 'address-a', normalizedAddress: 'Seller@example.com', relationship: 'confirmed' }]))
      .toMatchObject({ state: 'unresolved', reason: 'case_variant', partyId: null })
  })
  it('confirms one exact confirmed party and exposes only confirmed aliases for suppression', () => {
    const links = [
      { partyId: 'party-a', addressId: 'address-a', normalizedAddress: 'seller@example.com', relationship: 'confirmed' as const },
      { partyId: 'party-a', addressId: 'address-b', normalizedAddress: 'seller+reply@example.com', relationship: 'confirmed' as const },
      { partyId: 'party-a', addressId: 'address-c', normalizedAddress: 'seller-candidate@example.com', relationship: 'candidate' as const },
    ]
    expect(resolveEmailIdentity('seller@example.com', links)).toMatchObject({ state: 'confirmed', partyId: 'party-a' })
    expect(confirmedAliasAddressIds('party-a', links)).toEqual(['address-a', 'address-b'])
  })
  it('never selects a party from a shared address', () => {
    expect(resolveEmailIdentity('family@example.com', [
      { partyId: 'party-a', addressId: 'address-a', normalizedAddress: 'family@example.com', relationship: 'confirmed' },
      { partyId: 'party-b', addressId: 'address-a', normalizedAddress: 'family@example.com', relationship: 'shared' },
    ])).toMatchObject({ state: 'shared', partyId: null, candidatePartyIds: ['party-a', 'party-b'] })
  })
})
