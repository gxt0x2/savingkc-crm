import { describe, expect, it } from 'vitest'
import { campaignAudienceContactsHref, campaignAudienceReturnHref, parseStoredProspectingAudienceSelection, prospectingCampaignId, serializeProspectingAudienceSelection } from './audience-handoff'

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111'

describe('prospecting audience handoff', () => {
  it('keeps campaign context through contact selection and review', () => {
    expect(campaignAudienceContactsHref(CAMPAIGN_ID, 'August Absentee')).toBe(`/contacts?list=prospects&campaign=${CAMPAIGN_ID}&campaign_name=August+Absentee`)
    expect(campaignAudienceReturnHref(CAMPAIGN_ID)).toBe(`/prospecting?campaign=${CAMPAIGN_ID}&audience=1`)
  })

  it('rejects malformed campaign ids before they become navigation targets', () => {
    expect(prospectingCampaignId(CAMPAIGN_ID)).toBe(CAMPAIGN_ID)
    expect(prospectingCampaignId('not-a-campaign')).toBeNull()
  })

  it('round-trips a server-resolved full-results audience and reads legacy id arrays', () => {
    const selection = { mode: 'query' as const, count: 11, query: {
      smartList: 'prospects', sort: 'priority' as const, search: 'absentee', owner: '', stage: '', minimumStage: '',
      source: '', tag: '', activity: '', attention: '', outreach: '', dataGap: '',
    } }
    expect(parseStoredProspectingAudienceSelection(serializeProspectingAudienceSelection(selection))).toEqual(selection)
    expect(parseStoredProspectingAudienceSelection(JSON.stringify([CAMPAIGN_ID]))).toEqual({ mode: 'ids', leadIds: [CAMPAIGN_ID], count: 1 })
  })
})
