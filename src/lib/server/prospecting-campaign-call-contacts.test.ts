import { describe, expect, it } from 'vitest'

import { buildCampaignCallContactGroups, type CampaignCallContactSnapshot } from './prospecting-campaign-call-contacts'

const base: CampaignCallContactSnapshot = {
  id: 'snapshot-1',
  source_kind: 'prospect_phone',
  prospect_id: 'prospect-1',
  prospect_phone_id: 'phone-1',
  phone_snapshot: '+18165550100',
  contact_name: 'Jamie Heir',
  relationship: 'child',
  phone_type: 'mobile',
  status: 'ready',
  suppression_reason: null,
  enrolled_at: '2026-08-24T12:00:00.000Z',
}

describe('reviewed campaign calling contacts', () => {
  it('keeps the immutable reviewed phone while layering current attempt state', () => {
    const groups = buildCampaignCallContactGroups([base], new Map([['phone-1', {
      attempted: true,
      last_disposition: 'no_answer',
      last_attempt_at: '2026-08-24T13:00:00.000Z',
      is_verified_contact: false,
    }]]))

    expect(groups).toEqual([expect.objectContaining({
      contact_name: 'Jamie Heir',
      phones: [expect.objectContaining({
        id: 'snapshot-1',
        prospect_id: 'prospect-1',
        prospect_phone_id: 'phone-1',
        number: '+18165550100',
        attempted: true,
        last_disposition: 'no_answer',
      })],
    })])
  })

  it('keeps blocked contacts visible and makes detached source phones non-executable', () => {
    const groups = buildCampaignCallContactGroups([
      { ...base, id: 'suppressed', status: 'suppressed', suppression_reason: 'do_not_contact' },
      { ...base, id: 'detached', prospect_phone_id: null, phone_snapshot: '+18165550101' },
      { ...base, id: 'owner', source_kind: 'lead_primary', prospect_id: null, prospect_phone_id: null, relationship: 'owner', phone_snapshot: '+18165550102' },
    ], new Map())

    expect(groups.flatMap((group) => group.phones)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'suppressed', status: 'suppressed', suppression_reason: 'do_not_contact' }),
      expect.objectContaining({ id: 'detached', status: 'suppressed', suppression_reason: 'source_phone_removed' }),
      expect.objectContaining({ id: 'owner', status: 'ready', prospect_phone_id: null }),
    ]))
  })
})
