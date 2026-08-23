import { describe, expect, it } from 'vitest'

import { buildLeadProfilePatch } from './lead-profile-command'

describe('lead profile update command', () => {
  it('allowlists and normalizes editable profile fields', () => {
    expect(buildLeadProfilePatch({
      kind: 'profile',
      profile: {
        full_name: '  Seller Name  ',
        phone: '',
        station: 'closed_won',
        is_admin: true,
      },
    })).toEqual({
      ok: true,
      patch: { full_name: 'Seller Name', phone: null },
    })
  })

  it('accepts only a bounded numeric offer amount', () => {
    expect(buildLeadProfilePatch({ kind: 'offer_amount', offerAmount: 125_000 })).toEqual({
      ok: true,
      patch: { offer_amount: 125_000 },
    })
    expect(buildLeadProfilePatch({ kind: 'offer_amount', offerAmount: -1 })).toMatchObject({ ok: false })
  })

  it('rejects malformed and empty commands', () => {
    expect(buildLeadProfilePatch({ kind: 'profile', profile: {} })).toMatchObject({ ok: false })
    expect(buildLeadProfilePatch({ kind: 'profile', profile: { email: 42 } })).toMatchObject({ ok: false })
    expect(buildLeadProfilePatch({ kind: 'delete' })).toMatchObject({ ok: false })
  })
})
