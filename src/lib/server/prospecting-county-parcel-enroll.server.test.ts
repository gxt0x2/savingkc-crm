import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc } }))

import { enrollCountyProspectingCampaignMembers, enrollCountyProspectingCampaignMembersByIds } from './prospecting-campaigns'

const actor = { email: 'ernest@savingkc.com', name: 'Ernest A. Dodson III' }
const draftCampaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const twoYearPilotId = '5c45d2f7-c120-4477-bb1f-f04d69c4efdf'
const parcelIds = ['SYN-JACKSON-PARCEL-0001', 'SYN-JACKSON-PARCEL-0002']

describe('enrollCountyProspectingCampaignMembersByIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({
      data: { requested: 2, subjects: 2, eligible: 2, needsReview: 0, suppressed: 0, missing: 0 },
      error: null,
    })
  })

  it('enrolls the exact reviewed Jackson parcel set through the parcel-id command', async () => {
    await expect(enrollCountyProspectingCampaignMembersByIds(actor, draftCampaignId, {
      parcelIds,
      reviewedCount: 2,
    })).resolves.toMatchObject({ requested: 2, subjects: 2, eligible: 2 })

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('enroll_county_prospecting_campaign_members_by_ids_v1', {
      p_campaign_id: draftCampaignId,
      p_actor_email: actor.email,
      p_actor_name: actor.name,
      p_parcel_ids: parcelIds,
      p_reviewed_count: 2,
    })
    expect(mocks.rpc.mock.calls[0][0]).not.toBe('enroll_county_prospecting_campaign_members_v1')
    expect(mocks.rpc.mock.calls[0][1].p_campaign_id).not.toBe(twoYearPilotId)
  })

  it('rejects a reviewed count that does not match the parcel list before any campaign write', async () => {
    await expect(enrollCountyProspectingCampaignMembersByIds(actor, draftCampaignId, {
      parcelIds,
      reviewedCount: 3,
    })).rejects.toMatchObject({ code: 'county_audience_changed', status: 409 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('surfaces an active-campaign lock without writing members', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'campaign_members_locked' } })
    await expect(enrollCountyProspectingCampaignMembersByIds(actor, draftCampaignId, {
      parcelIds,
      reviewedCount: 2,
    })).rejects.toMatchObject({ code: 'invalid_campaign_state', status: 409 })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'enroll_county_prospecting_campaign_members_by_ids_v1',
      expect.objectContaining({ p_campaign_id: draftCampaignId }),
    )
  })

  it('leaves Saved View enrollment on its own command so the 2-year pilot is not an implicit target', async () => {
    mocks.rpc.mockResolvedValue({
      data: { requested: 86, subjects: 85, eligible: 84, needsReview: 0, suppressed: 1, missing: 1 },
      error: null,
    })
    await enrollCountyProspectingCampaignMembers(actor, twoYearPilotId, {
      savedView: 'tax_2yr',
      deceasedFilter: 'deceased',
      propertyFilter: 'residential',
      reviewedCount: 86,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('enroll_county_prospecting_campaign_members_v1', expect.objectContaining({
      p_campaign_id: twoYearPilotId,
      p_saved_view: 'tax_2yr',
    }))
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'enroll_county_prospecting_campaign_members_by_ids_v1',
      expect.anything(),
    )
  })
})
