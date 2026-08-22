export const PROSPECTING_AUDIENCE_STORAGE_KEY = 'savingkc-prospecting-audience-v1'
export const MAX_PROSPECTING_QUERY_AUDIENCE = 1000

export type ProspectingAudienceQuery = {
  smartList: string
  sort: 'priority' | 'recent' | 'name'
  search: string
  owner: string
  stage: string
  minimumStage: string
  source: string
  tag: string
  activity: string
  attention: string
  outreach: string
  dataGap: string
}

export type ProspectingAudienceSelection =
  | { mode: 'ids'; leadIds: string[]; count: number }
  | { mode: 'query'; query: ProspectingAudienceQuery; count: number }

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

export function serializeProspectingAudienceSelection(selection: ProspectingAudienceSelection): string {
  return JSON.stringify({ version: 2, ...selection })
}

export function parseStoredProspectingAudienceSelection(value: string | null): ProspectingAudienceSelection | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      const leadIds = parsed.filter((item): item is string => typeof item === 'string')
      return leadIds.length === parsed.length && leadIds.length > 0 ? { mode: 'ids', leadIds, count: leadIds.length } : null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<ProspectingAudienceSelection> & { version?: unknown }
    if (candidate.version !== 2 || candidate.mode !== 'query' || !candidate.query || typeof candidate.count !== 'number') return null
    return Number.isInteger(candidate.count) && candidate.count > 0 && candidate.count <= MAX_PROSPECTING_QUERY_AUDIENCE
      ? { mode: 'query', query: candidate.query, count: candidate.count }
      : null
  } catch {
    return null
  }
}
