import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildUserIdentifiers, readUserIdentifiers } from './enhanced-conversions'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('enhanced conversions for leads', () => {
  it('normalizes and hashes first-party email and phone identifiers', () => {
    expect(buildUserIdentifiers({
      email: ' ROB@example.COM ',
      phone: '(816) 608-8808',
    })).toEqual([
      {
        userIdentifierSource: 'FIRST_PARTY',
        hashedEmail: sha256Hex('rob@example.com'),
      },
      {
        userIdentifierSource: 'FIRST_PARTY',
        hashedPhoneNumber: sha256Hex('+18166088808'),
      },
    ])
  })

  it('drops unusable identifiers instead of storing raw contact values', () => {
    expect(buildUserIdentifiers({
      email: 'not-an-email',
      phone: '12345',
    })).toEqual([])
  })

  it('reads stored identifiers from an outbox payload', () => {
    const identifiers = buildUserIdentifiers({
      email: 'seller@example.com',
      phone: '+18166086648',
    })

    expect(readUserIdentifiers({ user_identifiers: identifiers })).toEqual(identifiers)
    expect(readUserIdentifiers({ user_identifiers: 'seller@example.com' })).toEqual([])
  })
})
