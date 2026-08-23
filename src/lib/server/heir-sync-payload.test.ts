import { describe, expect, it } from 'vitest'
import { parseHeirSyncRows } from './heir-sync-payload'

describe('heir sync provider payload', () => {
  it('normalizes, bounds, and deduplicates provider rows', () => {
    expect(parseHeirSyncRows({
      relatives: [{
        name: '  Jamie   Heir  ',
        relationship: 'Child',
        addresses: [{ street: '123 Main', city: 'Kansas City', state: 'MO', zip: '64101' }],
        phones: [
          { number: '(816) 555-0100', type: 'Mobile', is_connected: true },
          { number: '+1 816 555 0100', type: 'Home', is_connected: false },
          { number: 'invalid' },
        ],
      }],
    })).toEqual([{
      phone: '+18165550100',
      phone_type: 'Mobile',
      phone_connected: 'connected',
      contact_name: 'Jamie Heir',
      relationship: 'child',
      contact_address: '123 Main, Kansas City, MO, 64101',
    }])
  })

  it('omits owner and malformed records', () => {
    expect(parseHeirSyncRows({ relatives: [
      { name: 'Owner', relationship: 'owner', phones: [{ number: '8165550100' }] },
      { relationship: 'child', phones: [{ number: '8165550101' }] },
      null,
    ] })).toEqual([])
  })

  it('rejects an unbounded provider response instead of partially replacing data', () => {
    expect(() => parseHeirSyncRows({
      relatives: Array.from({ length: 101 }, (_, index) => ({ name: `Heir ${index}` })),
    })).toThrow('too many relatives')
  })
})
