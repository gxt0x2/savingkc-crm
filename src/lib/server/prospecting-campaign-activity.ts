import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import type { ProspectingCampaignActivity, ProspectingCampaignActivityPage } from '@/lib/prospecting/campaign-contract'
import { ProspectingCampaignError } from '@/lib/server/prospecting-campaigns'
import { supabase } from '@/lib/supabase-lazy'

type Cursor = { createdAt: string; id: string }

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>
    if (!parsed.createdAt || !parsed.id || Number.isNaN(Date.parse(parsed.createdAt)) || !/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error('invalid')
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    throw new ProspectingCampaignError('invalid_cursor', 400, 'Campaign activity cursor is invalid')
  }
}

function embeddedLead(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') return { fullName: null, propertyAddress: null }
  const lead = row as Record<string, unknown>
  return {
    fullName: typeof lead.full_name === 'string' ? lead.full_name : null,
    propertyAddress: typeof lead.property_address === 'string' ? lead.property_address : null,
  }
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function listProspectingCampaignActivity(
  actor: AuthenticatedActor,
  campaignId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<ProspectingCampaignActivityPage> {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new ProspectingCampaignError('invalid_campaign_id', 400, 'Campaign id is invalid')
  const limit = options.limit ?? 25
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ProspectingCampaignError('invalid_limit', 400, 'Activity limit must be between 1 and 50')
  const cursor = decodeCursor(options.cursor)

  const ownership = await supabase
    .from('prospecting_campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('owner_email', actor.email.toLowerCase())
    .maybeSingle()
  if (ownership.error) throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign activity is unavailable')
  if (!ownership.data) throw new ProspectingCampaignError('campaign_not_found', 404, 'Campaign not found')

  let eventQuery = supabase
    .from('prospecting_campaign_events')
    .select('id,event_type,actor,metadata,member_id,action_id,created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (cursor) eventQuery = eventQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
  const eventsResult = await eventQuery
  if (eventsResult.error) throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign activity is unavailable')
  const events = (eventsResult.data || []).slice(0, limit)
  const memberIds = Array.from(new Set(events.flatMap((event) => event.member_id ? [event.member_id] : [])))
  const actionIds = Array.from(new Set(events.flatMap((event) => event.action_id ? [event.action_id] : [])))

  const [membersResult, actionsResult] = await Promise.all([
    memberIds.length
      ? supabase.from('prospecting_campaign_members').select('id,lead_id,phone_snapshot,leads(full_name,property_address)').in('id', memberIds).limit(50)
      : Promise.resolve({ data: [], error: null }),
    actionIds.length
      ? supabase.from('prospecting_campaign_actions').select('id,status,scheduled_at,rendered_body,error_code,provider_sid,sent_at').in('id', actionIds).limit(50)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (membersResult.error || actionsResult.error) throw new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign activity is unavailable')

  const members = new Map((membersResult.data || []).map((member) => [member.id, member]))
  const actions = new Map((actionsResult.data || []).map((action) => [action.id, action]))
  const items: ProspectingCampaignActivity[] = events.map((event) => {
    const member = event.member_id ? members.get(event.member_id) : null
    const action = event.action_id ? actions.get(event.action_id) : null
    const lead = embeddedLead(member?.leads)
    const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
      ? event.metadata as Record<string, unknown>
      : {}
    return {
      id: event.id,
      eventType: event.event_type,
      actor: event.actor,
      memberId: event.member_id,
      leadId: text(member?.lead_id),
      actionId: event.action_id,
      status: action?.status as ProspectingCampaignActivity['status'] ?? null,
      sellerName: lead.fullName,
      phone: text(member?.phone_snapshot),
      propertyAddress: lead.propertyAddress,
      body: text(metadata.message) || text(action?.rendered_body),
      errorCode: text(action?.error_code) || text(metadata.error_code),
      providerSid: text(action?.provider_sid) || text(metadata.provider_sid),
      occurredAt: event.created_at,
      scheduledAt: text(action?.scheduled_at),
      sentAt: text(action?.sent_at),
    }
  })
  const hasMore = (eventsResult.data || []).length > limit
  const last = items.at(-1)
  return {
    items,
    pageInfo: { limit, hasMore, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.occurredAt, id: last.id }) : null },
  }
}
