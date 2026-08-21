import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import type { ProspectingCampaignMember, ProspectingCampaignMemberPage } from '@/lib/prospecting/campaign-contract'
import { ProspectingCampaignError } from '@/lib/server/prospecting-campaigns'
import { supabase } from '@/lib/supabase-lazy'

export const CAMPAIGN_MEMBER_FILTERS = ['all', 'active', 'suppressed', 'replied', 'completed', 'removed'] as const
export type CampaignMemberFilter = typeof CAMPAIGN_MEMBER_FILTERS[number]
type Cursor = { enrolledAt: string; id: string }

function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>
    if (!parsed.enrolledAt || !parsed.id || Number.isNaN(Date.parse(parsed.enrolledAt)) || !/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error('invalid')
    return { enrolledAt: parsed.enrolledAt, id: parsed.id }
  } catch {
    throw new ProspectingCampaignError('invalid_cursor', 400, 'Campaign audience cursor is invalid')
  }
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function embeddedLead(value: unknown): ProspectingCampaignMember['lead'] {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') return null
  const lead = row as Record<string, unknown>
  return {
    fullName: typeof lead.full_name === 'string' ? lead.full_name : null,
    propertyAddress: typeof lead.property_address === 'string' ? lead.property_address : null,
    station: typeof lead.station === 'string' ? lead.station : null,
    classification: typeof lead.classification === 'string' ? lead.classification : null,
  }
}

export async function listProspectingCampaignMembers(
  actor: AuthenticatedActor,
  campaignId: string,
  options: { limit?: number; cursor?: string | null; status?: CampaignMemberFilter } = {},
): Promise<ProspectingCampaignMemberPage> {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new ProspectingCampaignError('invalid_campaign_id', 400, 'Campaign id is invalid')
  const limit = options.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProspectingCampaignError('invalid_limit', 400, 'Audience limit must be between 1 and 100')
  const status = options.status ?? 'all'
  if (!CAMPAIGN_MEMBER_FILTERS.includes(status)) throw new ProspectingCampaignError('invalid_member_status', 400, 'Campaign audience status is invalid')
  const cursor = decodeCursor(options.cursor)

  const ownership = await supabase.from('prospecting_campaigns').select('id').eq('id', campaignId).eq('owner_email', actor.email.toLowerCase()).maybeSingle()
  if (ownership.error) throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign audience is unavailable')
  if (!ownership.data) throw new ProspectingCampaignError('campaign_not_found', 404, 'Campaign not found')

  let query = supabase
    .from('prospecting_campaign_members')
    .select('id,lead_id,phone_snapshot,timezone,status,suppression_reason,current_step_position,next_action_at,enrolled_at,leads(full_name,property_address,station,classification)')
    .eq('campaign_id', campaignId)
    .order('enrolled_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (status !== 'all') query = query.eq('status', status)
  if (cursor) query = query.or(`enrolled_at.lt.${cursor.enrolledAt},and(enrolled_at.eq.${cursor.enrolledAt},id.lt.${cursor.id})`)
  const result = await query
  if (result.error) throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign audience is unavailable')
  const rows = (result.data || []).slice(0, limit)
  const items: ProspectingCampaignMember[] = rows.map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    phone: row.phone_snapshot,
    timezone: row.timezone,
    status: row.status as ProspectingCampaignMember['status'],
    suppressionReason: row.suppression_reason,
    currentStepPosition: row.current_step_position,
    nextActionAt: row.next_action_at,
    enrolledAt: row.enrolled_at,
    lead: embeddedLead(row.leads),
  }))
  const hasMore = (result.data || []).length > limit
  const last = items.at(-1)
  return { items, pageInfo: { limit, hasMore, nextCursor: hasMore && last ? encodeCursor({ enrolledAt: last.enrolledAt, id: last.id }) : null } }
}
