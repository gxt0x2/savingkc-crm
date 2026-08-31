import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))

import { enrollCountyProspectingCampaignMembers, enrollCountyProspectingCampaignMembersByIds, enrollProspectingCampaignMembers } from './prospecting-campaigns'

const actor = { email: 'ernest@savingkc.com', name: 'Ernest A. Dodson III' }
const draftCampaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const twoYearPilotId = '5c45d2f7-c120-4477-bb1f-f04d69c4efdf'
const liveTax3PlusId = '74609ed4-7e26-4111-b626-b2e3f68efa0b'
const parcelIds = ['SYN-JACKSON-PARCEL-0001', 'SYN-JACKSON-PARCEL-0002']
const leadId = '11111111-1111-4111-8111-111111111111'

function chainableQuery(result: { data: unknown; error?: unknown }) {
  const query: Record<string, unknown> = {}
  const self = () => query
  query.select = vi.fn(self)
  query.eq = vi.fn(self)
  query.in = vi.fn(self)
  query.maybeSingle = vi.fn(async () => ({ data: result.data, error: result.error ?? null }))
  query.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error ?? null }).then(resolve, reject)
  return query
}

function mockCampaignAndProspects(input: {
  campaignId: string
  name: string
  kind?: string
  prospects?: Array<{ parcel_id?: string; lead_id?: string; is_deceased: boolean }>
}) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'prospecting_campaigns') {
      return chainableQuery({ data: { id: input.campaignId, name: input.name, kind: input.kind ?? 'dialer' } })
    }
    if (table === 'prospects') {
      return chainableQuery({ data: input.prospects ?? [] })
    }
    throw new Error(`unexpected table ${table}`)
  })
}

describe('enrollCountyProspectingCampaignMembersByIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({
      data: { requested: 2, subjects: 2, eligible: 2, needsReview: 0, suppressed: 0, missing: 0 },
      error: null,
    })
    mockCampaignAndProspects({ campaignId: draftCampaignId, name: 'Draft county cut' })
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
    mockCampaignAndProspects({ campaignId: twoYearPilotId, name: 'County Tax Delinquent 2-Year — Pilot' })
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

  it('rejects deceased county rows on the live Tax 3+ campaign before any member write', async () => {
    mockCampaignAndProspects({
      campaignId: liveTax3PlusId,
      name: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      prospects: [{ parcel_id: parcelIds[0], is_deceased: true }, { parcel_id: parcelIds[1], is_deceased: false }],
    })
    await expect(enrollCountyProspectingCampaignMembersByIds(actor, liveTax3PlusId, {
      parcelIds,
      reviewedCount: 2,
    })).rejects.toMatchObject({ code: 'tax_3_plus_excludes_deceased', status: 409 })
    await expect(enrollCountyProspectingCampaignMembers(actor, liveTax3PlusId, {
      savedView: 'tax_3yr_plus',
      deceasedFilter: 'deceased',
      propertyFilter: 'all',
      reviewedCount: 41,
    })).rejects.toMatchObject({ code: 'tax_3_plus_excludes_deceased', status: 409 })
    await expect(enrollCountyProspectingCampaignMembers(actor, liveTax3PlusId, {
      savedView: 'tax_3yr_plus',
      deceasedFilter: 'all',
      propertyFilter: 'all',
      reviewedCount: 48,
    })).rejects.toMatchObject({ code: 'tax_3_plus_excludes_deceased', status: 409 })
    await expect(enrollProspectingCampaignMembers(actor, liveTax3PlusId, [leadId]))
      .rejects.toMatchObject({ code: 'tax_3_plus_excludes_deceased', status: 409 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('enrolls living Tax 3+ parcels onto the live campaign without recutting existing members', async () => {
    mockCampaignAndProspects({
      campaignId: liveTax3PlusId,
      name: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      prospects: parcelIds.map((parcel_id) => ({ parcel_id, is_deceased: false })),
    })
    await expect(enrollCountyProspectingCampaignMembersByIds(actor, liveTax3PlusId, {
      parcelIds,
      reviewedCount: 2,
    })).resolves.toMatchObject({ requested: 2, subjects: 2 })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'enroll_county_prospecting_campaign_members_by_ids_v1',
      expect.objectContaining({ p_campaign_id: liveTax3PlusId, p_parcel_ids: parcelIds }),
    )
  })
})
