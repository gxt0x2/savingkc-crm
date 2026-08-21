export const PROSPECTING_AUDIENCE_STORAGE_KEY = 'savingkc-prospecting-audience-v1'

const CAMPAIGN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function prospectingCampaignId(value: string | null | undefined): string | null {
  const normalized = value?.trim() || ''
  return CAMPAIGN_ID.test(normalized) ? normalized : null
}

export function campaignAudienceContactsHref(campaignId: string, campaignName: string): string {
  const params = new URLSearchParams({ list: 'prospects', campaign: campaignId, campaign_name: campaignName.slice(0, 120) })
  return `/contacts?${params}`
}

export function campaignAudienceReturnHref(campaignId: string): string {
  const params = new URLSearchParams({ campaign: campaignId, audience: '1' })
  return `/prospecting?${params}`
}
