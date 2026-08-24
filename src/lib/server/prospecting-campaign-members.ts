import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import type { ProspectingCampaignMember, ProspectingCampaignMemberPage } from '@/lib/prospecting/campaign-contract'
import { ProspectingCampaignError } from '@/lib/server/prospecting-campaigns'
import { supabase } from '@/lib/supabase-lazy'

export const CAMPAIGN_MEMBER_FILTERS = ['all', 'active', 'needs_review', 'suppressed', 'replied', 'completed', 'removed'] as const
export type CampaignMemberFilter = typeof CAMPAIGN_MEMBER_FILTERS[number]
type Cursor = { enrolledAt: string; id: string; status: CampaignMemberFilter; query: string }

type CampaignMemberRow = {
  id: string
  subject_kind: 'lead' | 'prospect'
  lead_id: string | null
  prospect_id: string | null
  enrollment_source: 'crm_lead' | 'county_saved_view'
  phone_snapshot: string
  timezone: string
  status: ProspectingCampaignMember['status']
  suppression_reason: string | null
  current_step_position: number
  next_action_at: string | null
  enrolled_at: string
  subject_name: string | null
  subject_property_address: string | null
  subject_station: string | null
  subject_classification: string | null
  ready_contact_count: number | string
  suppressed_contact_count: number | string
}

function normalizeSearch(value: string | null | undefined) {
  const normalized = (value || '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (normalized.length > 100) throw new ProspectingCampaignError('invalid_member_query', 400, 'Audience search must be 100 characters or fewer')
  return normalized
}

function decodeCursor(value: string | null | undefined, status: CampaignMemberFilter, query: string): Cursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>
    if (!parsed.enrolledAt || !parsed.id || Number.isNaN(Date.parse(parsed.enrolledAt)) || !/^[0-9a-f-]{36}$/i.test(parsed.id)
      || parsed.status !== status || parsed.query !== query) throw new Error('invalid')
    return { enrolledAt: parsed.enrolledAt, id: parsed.id, status, query }
  } catch {
    throw new ProspectingCampaignError('invalid_cursor', 400, 'Campaign audience cursor is invalid')
  }
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function embeddedLead(row: CampaignMemberRow): ProspectingCampaignMember['lead'] {
  return {
    fullName: row.subject_name,
    propertyAddress: row.subject_property_address,
    station: row.subject_station,
    classification: row.subject_classification,
  }
}

export async function listProspectingCampaignMembers(
  actor: AuthenticatedActor,
  campaignId: string,
  options: { limit?: number; cursor?: string | null; status?: CampaignMemberFilter; query?: string | null } = {},
): Promise<ProspectingCampaignMemberPage> {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new ProspectingCampaignError('invalid_campaign_id', 400, 'Campaign id is invalid')
  const limit = options.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProspectingCampaignError('invalid_limit', 400, 'Audience limit must be between 1 and 100')
  const status = options.status ?? 'all'
  if (!CAMPAIGN_MEMBER_FILTERS.includes(status)) throw new ProspectingCampaignError('invalid_member_status', 400, 'Campaign audience status is invalid')
  const query = normalizeSearch(options.query)
  const cursor = decodeCursor(options.cursor, status, query)

  const result = await supabase.rpc('prospecting_campaign_member_page_v3', {
    p_actor_email: actor.email,
    p_campaign_id: campaignId,
    p_status: status,
    p_query: query || null,
    p_limit: limit,
    p_after_enrolled_at: cursor?.enrolledAt || null,
    p_after_id: cursor?.id || null,
  })
  if (result.error) {
    const message = String(result.error.message || '').toLowerCase()
    if (message.includes('campaign_not_found')) throw new ProspectingCampaignError('campaign_not_found', 404, 'Campaign not found')
    throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign audience is unavailable')
  }
  const allRows = (result.data || []) as CampaignMemberRow[]
  const rows = allRows.slice(0, limit)
  const items: ProspectingCampaignMember[] = rows.map((row) => ({
    id: row.id,
    subjectKind: row.subject_kind,
    leadId: row.lead_id,
    prospectId: row.prospect_id,
    enrollmentSource: row.enrollment_source,
    phone: row.phone_snapshot,
    timezone: row.timezone,
    status: row.status as ProspectingCampaignMember['status'],
    suppressionReason: row.suppression_reason,
    currentStepPosition: row.current_step_position,
    nextActionAt: row.next_action_at,
    enrolledAt: row.enrolled_at,
    readyContactCount: Number(row.ready_contact_count) || 0,
    suppressedContactCount: Number(row.suppressed_contact_count) || 0,
    lead: embeddedLead(row),
  }))
  const hasMore = allRows.length > limit
  const last = items.at(-1)
  return { items, pageInfo: { limit, hasMore, nextCursor: hasMore && last ? encodeCursor({ enrolledAt: last.enrolledAt, id: last.id, status, query }) : null } }
}
