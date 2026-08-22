import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  MAX_PROSPECTING_QUERY_AUDIENCE,
  type ProspectingAudienceQuery,
  type ProspectingAudienceSelection,
} from '@/lib/prospecting/audience-handoff'
import { parseLeadIds } from '@/lib/prospecting/campaign-contract'
import { decodeContactDirectoryCursor, readContactDirectoryPage, type ContactDirectoryCursor } from '@/lib/server/contact-directory-read-model'
import { enrollProspectingCampaignMembers, ProspectingCampaignError } from '@/lib/server/prospecting-campaigns'

const SMART_LISTS = new Set([
  'new', 'hot', 'contacted', 'qualified', 'appointment_set', 'offer_made',
  'in_closing', 'all', 'needs_reply', 'overdue', 'unassigned', 'prospects', 'not_leads',
])
const SORTS = new Set(['priority', 'recent', 'name'])

function text(value: unknown, maximum = 120): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

export function parseProspectingAudienceQuery(value: unknown): ProspectingAudienceQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProspectingCampaignError('invalid_audience_query', 400, 'Campaign audience filters are invalid')
  }
  const input = value as Record<string, unknown>
  const smartList = text(input.smartList, 40)
  const sort = text(input.sort, 20)
  if (!SMART_LISTS.has(smartList) || !SORTS.has(sort)) {
    throw new ProspectingCampaignError('invalid_audience_query', 400, 'Campaign audience filters are invalid')
  }
  return {
    smartList,
    sort: sort as ProspectingAudienceQuery['sort'],
    search: text(input.search, 100),
    owner: text(input.owner),
    stage: text(input.stage, 40),
    minimumStage: text(input.minimumStage, 40),
    source: text(input.source),
    tag: text(input.tag),
    activity: text(input.activity, 40),
    attention: text(input.attention, 40),
    outreach: text(input.outreach, 40),
    dataGap: text(input.dataGap, 40),
  }
}

export function parseProspectingAudienceSelection(value: unknown): ProspectingAudienceSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProspectingCampaignError('invalid_members', 400, 'Choose at least one contact')
  }
  const input = value as Record<string, unknown>
  if (input.mode === 'ids') {
    const leadIds = parseLeadIds(input.leadIds)
    return { mode: 'ids', leadIds, count: leadIds.length }
  }
  if (input.mode === 'query') {
    const count = Number(input.count)
    if (!Number.isInteger(count) || count < 1 || count > MAX_PROSPECTING_QUERY_AUDIENCE) {
      throw new ProspectingCampaignError('invalid_audience_query', 400, `Narrow the audience to ${MAX_PROSPECTING_QUERY_AUDIENCE.toLocaleString()} contacts or fewer`)
    }
    return { mode: 'query', query: parseProspectingAudienceQuery(input.query), count }
  }
  throw new ProspectingCampaignError('invalid_members', 400, 'Choose at least one contact')
}

async function resolveQueryLeadIds(query: ProspectingAudienceQuery, reviewedCount: number): Promise<string[]> {
  const referenceTime = new Date().toISOString()
  const scope = query.smartList === 'prospects' ? 'prospects' : query.smartList === 'not_leads' ? 'not_leads' : 'active'
  const leadIds: string[] = []
  let cursor: ContactDirectoryCursor | null = null
  let expectedTotal: number | null = null
  let finished = false

  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await readContactDirectoryPage({
      ...query,
      scope,
      limit: 50,
      cursor,
      referenceTime,
    })
    if (expectedTotal === null) {
      expectedTotal = page.totalCount
      if (expectedTotal < 1) throw new ProspectingCampaignError('invalid_members', 400, 'No contacts match this audience anymore')
      if (expectedTotal > MAX_PROSPECTING_QUERY_AUDIENCE) {
        throw new ProspectingCampaignError('audience_too_large', 400, `Narrow the audience to ${MAX_PROSPECTING_QUERY_AUDIENCE.toLocaleString()} contacts or fewer`)
      }
      if (expectedTotal !== reviewedCount) throw new ProspectingCampaignError('audience_changed', 409, 'The contact list changed. Review the audience again')
    }
    leadIds.push(...page.items.map((item) => item.id))
    if (!page.hasMore) {
      finished = true
      break
    }
    const nextCursor = page.nextCursor
    if (!nextCursor) throw new ProspectingCampaignError('audience_changed', 409, 'The contact list changed. Review the audience again')
    cursor = decodeContactDirectoryCursor(nextCursor)
    if (!cursor) throw new ProspectingCampaignError('audience_changed', 409, 'The contact list changed. Review the audience again')
  }

  const uniqueIds = Array.from(new Set(leadIds))
  if (!finished || expectedTotal === null || uniqueIds.length !== expectedTotal) {
    throw new ProspectingCampaignError('audience_changed', 409, 'The contact list changed. Review the audience again')
  }
  return uniqueIds
}

export async function enrollProspectingAudienceSelection(
  actor: AuthenticatedActor,
  campaignId: string,
  selection: ProspectingAudienceSelection,
) {
  const leadIds = selection.mode === 'ids' ? selection.leadIds : await resolveQueryLeadIds(selection.query, selection.count)
  return enrollProspectingCampaignMembers(actor, campaignId, leadIds)
}
