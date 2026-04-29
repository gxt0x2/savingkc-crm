/**
 * ARI CRM - Ari Briefing Engine
 * Night 3: Proactive Intelligence
 * ARI-01, ARI-02, ARI-03
 *
 * Event-driven briefing system that surfaces what matters
 */

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// TYPES
// ============================================================================

export type BriefingEventType =
  | 'new_lead'
  | 'incoming_call'
  | 'incoming_sms'
  | 'incoming_email'
  | 'stage_change'
  | 'contract_event'
  | 'missed_call'
  | 'follow_up_overdue'
  | 'ghost_protocol'
  | 'eod_submission'
  | 'system_failure'
  | 'stage_timeout'
  | 'temperature_change'
  | 'closing_event'
  | 'show_rate_alert'

export type BriefingPriority = 'critical' | 'high' | 'medium' | 'low'

export interface BriefingEvent {
  id?: string
  event_type: BriefingEventType
  priority: BriefingPriority
  title: string
  description: string
  lead_id?: string
  action_url?: string
  metadata?: Record<string, any>
  read?: boolean
  dismissed?: boolean
  created_at?: string
}

// ============================================================================
// EVENT CREATION
// ============================================================================

/**
 * Create a new Ari briefing event
 */
export async function createBriefingEvent(
  event: BriefingEvent
): Promise<{ success: boolean; id?: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data, error } = await supabase
    .from('ari_briefing_events')
    .insert({
      event_type: event.event_type,
      priority: event.priority,
      title: event.title,
      description: event.description,
      lead_id: event.lead_id || null,
      action_url: event.action_url || null,
      metadata: event.metadata || {},
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to create briefing event:', error)
    return { success: false }
  }

  return { success: true, id: data.id }
}

/**
 * Batch create multiple briefing events
 */
export async function createBriefingEvents(
  events: BriefingEvent[]
): Promise<{ success: boolean; count: number }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data, error } = await supabase.from('ari_briefing_events').insert(
    events.map((e) => ({
      event_type: e.event_type,
      priority: e.priority,
      title: e.title,
      description: e.description,
      lead_id: e.lead_id || null,
      action_url: e.action_url || null,
      metadata: e.metadata || {},
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    }))
  )

  if (error) {
    console.error('Failed to create briefing events:', error)
    return { success: false, count: 0 }
  }

  return { success: true, count: events.length }
}

// ============================================================================
// EVENT RETRIEVAL (with Priority Stacking - ARI-02)
// ============================================================================

/**
 * Get recent briefing events with priority stacking
 * Returns events in priority order: Critical → High → Medium → Low
 * Within same priority, most recent first
 */
export async function getBriefingEvents(options: {
  limit?: number
  includeRead?: boolean
  includeDismissed?: boolean
}): Promise<BriefingEvent[]> {
  const { limit = 10, includeRead = false, includeDismissed = false } = options

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  let query = supabase
    .from('ari_briefing_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100) // Get more than needed for sorting

  if (!includeRead) {
    query = query.eq('read', false)
  }

  if (!includeDismissed) {
    query = query.eq('dismissed', false)
  }

  const { data, error } = await query

  if (error || !data) {
    console.error('Failed to fetch briefing events:', error)
    return []
  }

  // Priority stacking: sort by priority first, then by recency
  const priorityOrder: Record<BriefingPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  }

  const tcEvents = await getTcRiskBriefingEvents(supabase)
  const sorted = [...data, ...tcEvents].sort((a, b) => {
    const priorityDiff =
      priorityOrder[a.priority as BriefingPriority] -
      priorityOrder[b.priority as BriefingPriority]
    if (priorityDiff !== 0) return priorityDiff

    // Same priority - most recent first
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  })

  return sorted.slice(0, limit)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTcRiskBriefingEvents(supabase: SupabaseClient<any, 'public', any>): Promise<BriefingEvent[]> {
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('tc_files')
    .select('id, lead_id, status, risk_level, next_action, emd_due_at, closing_scheduled_at, hud_received_at, revenue_logged_at, lead:lead_id(property_address)')
    .neq('status', 'closed')
    .limit(25)

  const events: BriefingEvent[] = []
  type TcRiskRow = {
    id: string
    lead_id: string
    status: string
    risk_level: string
    next_action: string | null
    emd_due_at: string | null
    closing_scheduled_at: string | null
    lead?: { property_address?: string | null } | { property_address?: string | null }[] | null
  }

  for (const file of (data ?? []) as TcRiskRow[]) {
    const lead = Array.isArray(file.lead) ? file.lead[0] : file.lead
    const address = lead?.property_address || 'TC file'
    if (file.risk_level === 'blocked') {
      events.push({
        id: `tc-blocked-${file.id}`,
        event_type: 'closing_event',
        priority: 'critical',
        title: `TC blocked: ${address}`,
        description: file.next_action || 'Transaction file is blocked and needs owner action.',
        lead_id: file.lead_id,
        action_url: '/dispo/tc',
        metadata: { tc_file_id: file.id, status: file.status },
        created_at: new Date().toISOString(),
      })
    } else if (file.emd_due_at && file.emd_due_at <= in24h && file.status !== 'emd_pending') {
      events.push({
        id: `tc-emd-${file.id}`,
        event_type: 'closing_event',
        priority: 'high',
        title: `Confirm EMD: ${address}`,
        description: 'EMD deadline is inside 24 hours. Confirm receipt or move the TC file to EMD pending.',
        lead_id: file.lead_id,
        action_url: '/dispo/tc',
        metadata: { tc_file_id: file.id, emd_due_at: file.emd_due_at },
        created_at: new Date().toISOString(),
      })
    } else if (file.closing_scheduled_at && file.closing_scheduled_at <= in7d && !['clear_to_close', 'scheduled'].includes(file.status)) {
      events.push({
        id: `tc-title-clear-${file.id}`,
        event_type: 'closing_event',
        priority: 'high',
        title: `Title not clear: ${address}`,
        description: 'Closing is within 7 days and the TC file is not clear to close.',
        lead_id: file.lead_id,
        action_url: '/dispo/tc',
        metadata: { tc_file_id: file.id, closing_scheduled_at: file.closing_scheduled_at, status: file.status },
        created_at: new Date().toISOString(),
      })
    }
  }
  return events
}

/**
 * Get events for a specific lead
 */
export async function getLeadBriefingEvents(
  leadId: string
): Promise<BriefingEvent[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data } = await supabase
    .from('ari_briefing_events')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(20)

  return (data as BriefingEvent[]) || []
}

/**
 * Mark event as read
 */
export async function markBriefingEventRead(
  eventId: string
): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { error } = await supabase
    .from('ari_briefing_events')
    .update({ read: true })
    .eq('id', eventId)

  return !error
}

/**
 * Dismiss event
 */
export async function dismissBriefingEvent(eventId: string): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { error } = await supabase
    .from('ari_briefing_events')
    .update({ dismissed: true })
    .eq('id', eventId)

  return !error
}

// ============================================================================
// COMMON EVENT CREATORS (shortcuts for common events)
// ============================================================================

/**
 * Create event for new lead
 */
export async function notifyNewLead(
  leadId: string,
  leadName: string | null,
  source: string
) {
  return createBriefingEvent({
    event_type: 'new_lead',
    priority: 'critical',
    title: `New lead: ${leadName || 'Unknown'}`,
    description: `New lead from ${source}. Immediate contact attempt required.`,
    lead_id: leadId,
    action_url: `/leads/${leadId}`,
    metadata: { source },
  })
}

/**
 * Create event for incoming communication
 */
export async function notifyIncomingCommunication(
  leadId: string,
  leadName: string | null,
  type: 'call' | 'sms' | 'email',
  preview: string
) {
  const typeMap = {
    call: { event: 'incoming_call' as const, priority: 'high' as const },
    sms: { event: 'incoming_sms' as const, priority: 'high' as const },
    email: { event: 'incoming_email' as const, priority: 'medium' as const },
  }

  const config = typeMap[type]

  return createBriefingEvent({
    event_type: config.event,
    priority: config.priority,
    title: `${leadName || 'Lead'} ${type === 'call' ? 'called' : type === 'sms' ? 'texted' : 'emailed'}`,
    description: preview,
    lead_id: leadId,
    action_url:
      type === 'call' ? `/leads/${leadId}` : `/conversations?lead=${leadId}`,
  })
}

/**
 * Create event for stage change
 */
export async function notifyStageChange(
  leadId: string,
  leadName: string | null,
  fromStage: string,
  toStage: string
) {
  return createBriefingEvent({
    event_type: 'stage_change',
    priority: 'medium',
    title: `${leadName || 'Lead'} → ${toStage}`,
    description: `Lead advanced from ${fromStage} to ${toStage}`,
    lead_id: leadId,
    action_url: `/leads/${leadId}`,
    metadata: { fromStage, toStage },
  })
}

/**
 * Create event for missed call
 */
export async function notifyMissedCall(
  leadId: string | null,
  phoneNumber: string,
  leadName: string | null
) {
  return createBriefingEvent({
    event_type: 'missed_call',
    priority: 'high',
    title: `Missed call: ${leadName || phoneNumber}`,
    description: leadId
      ? `Missed call from ${leadName}. Auto text-back sent, callback task created.`
      : `Missed call from unknown number ${phoneNumber}. Generic text-back sent.`,
    lead_id: leadId || undefined,
    action_url: leadId ? `/leads/${leadId}` : undefined,
    metadata: { phoneNumber },
  })
}

/**
 * Create event for overdue follow-up
 */
export async function notifyFollowUpOverdue(
  leadId: string,
  leadName: string | null,
  taskDescription: string,
  daysOverdue: number
) {
  return createBriefingEvent({
    event_type: 'follow_up_overdue',
    priority: daysOverdue > 3 ? 'high' : 'medium',
    title: `Overdue: ${leadName || 'Lead'}`,
    description: `Follow-up task "${taskDescription}" is ${daysOverdue} days overdue`,
    lead_id: leadId,
    action_url: `/leads/${leadId}`,
    metadata: { daysOverdue },
  })
}

/**
 * Create event for EOD submission
 */
export async function notifyEODSubmission(agentName: string) {
  return createBriefingEvent({
    event_type: 'eod_submission',
    priority: 'medium',
    title: `EOD submitted by ${agentName}`,
    description: `End of day report submitted. Mojo metrics refreshed.`,
    action_url: '/dashboard',
  })
}

/**
 * Create event for system failure
 */
export async function notifySystemFailure(
  system: string,
  errorMessage: string
) {
  return createBriefingEvent({
    event_type: 'system_failure',
    priority: 'critical',
    title: `System failure: ${system}`,
    description: errorMessage,
    metadata: { system, errorMessage },
  })
}
