import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import {
  type CreateProspectingCampaignInput,
  type ProspectingCampaignDetail,
  type ProspectingCampaignMember,
  type ProspectingCampaignStatus,
  type ProspectingCampaignSummary,
  type ProspectingCampaignStep,
} from '@/lib/prospecting/campaign-contract'
import { parseDialerSession } from '@/lib/server/dialer-session-engine'
import { supabase } from '@/lib/supabase-lazy'

export class ProspectingCampaignError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message)
  }
}

type CampaignRow = {
  id: string
  name: string
  kind: 'dialer' | 'sms'
  status: ProspectingCampaignStatus
  owner_email: string
  owner_name: string
  caller_id: string | null
  from_phone: string | null
  default_timezone: string
  send_window_start: string
  send_window_end: string
  send_days: number[]
  per_hour: number
  per_day: number
  created_at: string
  updated_at: string
  activated_at: string | null
  paused_at: string | null
  completed_at: string | null
}

const CAMPAIGN_SELECT = 'id,name,kind,status,owner_email,owner_name,caller_id,from_phone,default_timezone,send_window_start,send_window_end,send_days,per_hour,per_day,created_at,updated_at,activated_at,paused_at,completed_at'

function mapCampaign(row: CampaignRow): ProspectingCampaignSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
    callerId: row.caller_id,
    fromPhone: row.from_phone,
    defaultTimezone: row.default_timezone,
    sendWindowStart: row.send_window_start.slice(0, 5),
    sendWindowEnd: row.send_window_end.slice(0, 5),
    sendDays: row.send_days,
    perHour: row.per_hour,
    perDay: row.per_day,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at,
    pausedAt: row.paused_at,
    completedAt: row.completed_at,
  }
}

function databaseError(error: { message?: string; code?: string } | null | undefined): ProspectingCampaignError {
  const detail = `${error?.message || ''} ${error?.code || ''}`.toLowerCase()
  if (detail.includes('campaign_member_not_found')) return new ProspectingCampaignError('campaign_member_not_found', 404, 'Campaign contact not found')
  if (detail.includes('campaign_not_found') || detail.includes('pgrst116')) return new ProspectingCampaignError('campaign_not_found', 404, 'Campaign not found')
  if (detail.includes('campaign_has_no_eligible_members')) return new ProspectingCampaignError('campaign_empty', 409, 'Add at least one eligible contact before activating')
  if (detail.includes('campaign_has_no_steps')) return new ProspectingCampaignError('campaign_steps_required', 409, 'Add at least one message step before activating')
  if (detail.includes('campaign_dialer_complete')) return new ProspectingCampaignError('campaign_dialer_complete', 409, 'Every ready contact has been worked. Review skipped or suppressed contacts before starting another batch')
  if (detail.includes('campaign_setup_locked')) return new ProspectingCampaignError('campaign_setup_locked', 409, 'Only a campaign that has never run can be edited')
  if (detail.includes('campaign_member_in_active_dialer_batch')) return new ProspectingCampaignError('campaign_member_in_active_dialer_batch', 409, 'Stop the open calling session before removing this contact')
  if (detail.includes('campaign_members_locked') || detail.includes('invalid_campaign_transition')) return new ProspectingCampaignError('invalid_campaign_state', 409, 'Pause the campaign before changing its audience')
  if (detail.includes('invalid_') || detail.includes('23514') || detail.includes('23505') || detail.includes('22p02')) return new ProspectingCampaignError('invalid_campaign', 400, 'Campaign details are invalid')
  if (detail.includes('does not exist') || detail.includes('pgrst202') || detail.includes('42p01') || detail.includes('42883')) {
    return new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Prospecting campaigns are not available in this environment')
  }
  return new ProspectingCampaignError('campaign_engine_unavailable', 503, 'Campaign state could not be saved')
}

type CampaignCursor = { updatedAt: string; id: string }

function encodeCursor(cursor: CampaignCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): CampaignCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CampaignCursor>
    if (!parsed.updatedAt || !parsed.id || Number.isNaN(Date.parse(parsed.updatedAt)) || !/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error('invalid')
    return { updatedAt: parsed.updatedAt, id: parsed.id }
  } catch {
    throw new ProspectingCampaignError('invalid_cursor', 400, 'Campaign cursor is invalid')
  }
}

export async function listProspectingCampaigns(
  actor: AuthenticatedActor,
  options: { limit?: number; cursor?: string | null } = {},
) {
  const limit = options.limit ?? 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ProspectingCampaignError('invalid_limit', 400, 'Campaign limit must be between 1 and 50')
  const cursor = decodeCursor(options.cursor)
  let query = supabase
    .from('prospecting_campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('owner_email', actor.email.toLowerCase())
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (cursor) query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`)
  const { data, error } = await query
  if (error) throw databaseError(error)
  const rows = (data || []) as CampaignRow[]
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map(mapCampaign)
  const last = items.at(-1)
  return {
    items,
    pageInfo: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }) : null,
    },
  }
}

export async function createProspectingCampaign(actor: AuthenticatedActor, input: CreateProspectingCampaignInput) {
  const { data, error } = await supabase.rpc('create_prospecting_campaign_v2', {
    p_owner_email: actor.email,
    p_owner_name: actor.name,
    p_name: input.name,
    p_kind: input.kind,
    p_caller_id: input.callerId,
    p_from_phone: input.fromPhone,
    p_default_timezone: input.defaultTimezone,
    p_send_window_start: input.sendWindowStart,
    p_send_window_end: input.sendWindowEnd,
    p_send_days: input.sendDays,
    p_per_hour: input.perHour,
    p_per_day: input.perDay,
    p_steps: input.steps,
  })
  if (error) throw databaseError(error)
  return getProspectingCampaign(actor, String(data))
}

export async function updateProspectingCampaignDraft(
  actor: AuthenticatedActor,
  campaignId: string,
  input: CreateProspectingCampaignInput,
) {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new ProspectingCampaignError('invalid_campaign_id', 400, 'Campaign id is invalid')
  const { error } = await supabase.rpc('update_prospecting_campaign_draft_v2', {
    p_campaign_id: campaignId,
    p_actor_email: actor.email,
    p_actor_name: actor.name,
    p_name: input.name,
    p_kind: input.kind,
    p_caller_id: input.callerId,
    p_from_phone: input.fromPhone,
    p_default_timezone: input.defaultTimezone,
    p_send_window_start: input.sendWindowStart,
    p_send_window_end: input.sendWindowEnd,
    p_send_days: input.sendDays,
    p_per_hour: input.perHour,
    p_per_day: input.perDay,
    p_steps: input.steps,
  })
  if (error) throw databaseError(error)
  return getProspectingCampaign(actor, campaignId)
}

function mapStep(row: { id: string; position: number; delay_minutes: number; body_template: string }): ProspectingCampaignStep {
  return { id: row.id, position: row.position, delayMinutes: row.delay_minutes, bodyTemplate: row.body_template }
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

export async function getProspectingCampaign(actor: AuthenticatedActor, campaignId: string): Promise<ProspectingCampaignDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new ProspectingCampaignError('invalid_campaign_id', 400, 'Campaign id is invalid')
  const campaignPromise = supabase
    .from('prospecting_campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('id', campaignId)
    .eq('owner_email', actor.email.toLowerCase())
    .maybeSingle()
  const stepsPromise = supabase
    .from('prospecting_campaign_steps')
    .select('id,position,delay_minutes,body_template')
    .eq('campaign_id', campaignId)
    .order('position')
    .limit(12)
  const membersPromise = supabase
    .from('prospecting_campaign_members')
    .select('id,lead_id,phone_snapshot,timezone,status,suppression_reason,current_step_position,next_action_at,enrolled_at,leads(full_name,property_address,station,classification)')
    .eq('campaign_id', campaignId)
    .neq('status', 'removed')
    .order('enrolled_at', { ascending: false })
    .limit(100)
  const counts = Promise.all([
    supabase.from('prospecting_campaign_members').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).neq('status', 'removed'),
    supabase.from('prospecting_campaign_members').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'active'),
    supabase.from('prospecting_campaign_members').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'suppressed'),
    supabase.from('prospecting_campaign_members').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'replied'),
    supabase.from('prospecting_campaign_members').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'completed'),
    supabase.from('prospecting_campaign_actions').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).in('status', ['sent', 'delivered']),
    supabase.from('prospecting_campaign_actions').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'failed'),
  ])
  const operations = Promise.all([
    supabase.from('prospecting_campaign_actions').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'queued'),
    supabase.from('prospecting_campaign_actions').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'processing'),
    supabase.from('prospecting_campaign_actions').select('scheduled_at').eq('campaign_id', campaignId).eq('status', 'queued').order('scheduled_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('prospecting_campaign_actions').select('sent_at').eq('campaign_id', campaignId).in('status', ['sent', 'delivered']).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const [campaignResult, stepsResult, membersResult, countResults, operationResults] = await Promise.all([campaignPromise, stepsPromise, membersPromise, counts, operations])
  if (campaignResult.error) throw databaseError(campaignResult.error)
  if (!campaignResult.data) throw new ProspectingCampaignError('campaign_not_found', 404, 'Campaign not found')
  if (stepsResult.error) throw databaseError(stepsResult.error)
  if (membersResult.error) throw databaseError(membersResult.error)
  for (const result of countResults) if (result.error) throw databaseError(result.error)
  for (const result of operationResults) if (result.error) throw databaseError(result.error)

  const members: ProspectingCampaignMember[] = (membersResult.data || []).map((row) => ({
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
  return {
    ...mapCampaign(campaignResult.data as CampaignRow),
    steps: (stepsResult.data || []).map(mapStep),
    members,
    stats: {
      total: countResults[0].count || 0,
      active: countResults[1].count || 0,
      suppressed: countResults[2].count || 0,
      replied: countResults[3].count || 0,
      completed: countResults[4].count || 0,
      sent: countResults[5].count || 0,
      failed: countResults[6].count || 0,
    },
    operations: {
      queued: operationResults[0].count || 0,
      processing: operationResults[1].count || 0,
      nextActionAt: operationResults[2].data?.scheduled_at || null,
      lastSentAt: operationResults[3].data?.sent_at || null,
    },
  }
}

export async function enrollProspectingCampaignMembers(actor: AuthenticatedActor, campaignId: string, leadIds: string[]) {
  const { data, error } = await supabase.rpc('enroll_prospecting_campaign_members_v1', {
    p_campaign_id: campaignId,
    p_actor_email: actor.email,
    p_actor_name: actor.name,
    p_lead_ids: leadIds,
  })
  if (error) throw databaseError(error)
  return data as { requested: number; eligible: number; suppressed: number; missing: number }
}

export async function removeProspectingCampaignMember(actor: AuthenticatedActor, campaignId: string, memberId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId) || !/^[0-9a-f-]{36}$/i.test(memberId)) {
    throw new ProspectingCampaignError('invalid_campaign_member', 400, 'Campaign contact is invalid')
  }
  const { data, error } = await supabase.rpc('remove_prospecting_campaign_member_v1', {
    p_campaign_id: campaignId,
    p_member_id: memberId,
    p_actor_email: actor.email,
    p_actor_name: actor.name,
  })
  if (error) throw databaseError(error)
  return data as { id: string; status: 'removed'; removed: boolean; cancelledActions: number }
}

export async function activateProspectingCampaign(actor: AuthenticatedActor, campaignId: string) {
  const { data, error } = await supabase.rpc('activate_prospecting_campaign_v1', {
    p_campaign_id: campaignId,
    p_actor_email: actor.email,
    p_actor_name: actor.name,
  })
  if (error) throw databaseError(error)
  return data as { id: string; status: 'active'; eligibleMembers: number }
}

export async function setProspectingCampaignStatus(
  actor: AuthenticatedActor,
  campaignId: string,
  status: Extract<ProspectingCampaignStatus, 'paused' | 'active' | 'archived'>,
) {
  const campaign = await getProspectingCampaign(actor, campaignId)
  if (status === 'active') return activateProspectingCampaign(actor, campaignId)
  if (status === 'paused' && campaign.status !== 'active') throw new ProspectingCampaignError('invalid_campaign_state', 409, 'Only active campaigns can be paused')
  if (status === 'archived' && campaign.status === 'active') throw new ProspectingCampaignError('invalid_campaign_state', 409, 'Pause the campaign before archiving it')
  const update = status === 'paused'
    ? { status, paused_at: new Date().toISOString() }
    : { status, completed_at: new Date().toISOString() }
  const { error } = await supabase
    .from('prospecting_campaigns')
    .update(update)
    .eq('id', campaignId)
    .eq('owner_email', actor.email.toLowerCase())
  if (error) throw databaseError(error)
  await supabase.from('prospecting_campaign_events').insert({
    campaign_id: campaignId,
    event_type: `campaign_${status}`,
    actor: actor.name,
    metadata: {},
  })
  return { id: campaignId, status }
}

export async function launchProspectingDialerCampaign(actor: AuthenticatedActor, campaignId: string) {
  const campaign = await getProspectingCampaign(actor, campaignId)
  if (campaign.kind !== 'dialer') throw new ProspectingCampaignError('invalid_campaign_kind', 409, 'Only dialer campaigns can start a calling session')
  if (campaign.status !== 'active') throw new ProspectingCampaignError('invalid_campaign_state', 409, 'Activate the campaign before starting calls')
  const callerId = normalizePhoneToE164(campaign.callerId || '')
  if (!callerId) throw new ProspectingCampaignError('caller_id_required', 409, 'Choose a calling number before starting')
  const { data, error } = await supabase.rpc('start_prospecting_dialer_session_v1', {
    p_campaign_id: campaignId,
    p_actor_email: actor.email,
    p_actor_name: actor.name,
    p_caller_id: callerId,
  })
  if (error) throw databaseError(error)
  const payload = data as { created?: unknown; session?: unknown; batchSize?: unknown; remaining?: unknown } | null
  return {
    created: payload?.created === true,
    session: parseDialerSession(payload?.session),
    batchSize: Number(payload?.batchSize) || 0,
    remaining: Number(payload?.remaining) || 0,
  }
}
