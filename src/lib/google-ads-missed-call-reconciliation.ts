import { getAgentRouting, type AgentRouting } from '@/lib/agent-routing'
import {
  GOOGLE_ADS_PHONE_NUMBER,
  GOOGLE_ADS_PHONE_PROFILES,
  getGoogleAdsPhoneProfile,
} from '@/lib/call-quality-events'
import { isInternalTestPhone } from '@/lib/internal-test-phones'
import {
  callerPhoneLabel,
  googleAdsNewCallTeamMessage,
  googleAdsEscalationReminderMessage,
  hasGoogleAdsLeadRespondedSince,
  notifyGoogleAdsTeam,
  phoneLookupVariants,
  resolveGoogleAdsLeadContext,
  startGoogleAdsAgentCallback,
} from '@/lib/google-ads-phone'
import { getTwilioClient } from '@/lib/safe-communications'
import { supabase } from '@/lib/supabase-lazy'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const TERMINAL_TWILIO_CALL_STATUSES = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled'])
const ESCALATION_SKIP_STATIONS = new Set(['dead', 'closed_lost'])

type ActivityMetadata = Record<string, unknown>

export type GoogleAdsMissedCallTaskRow = {
  id: string
  lead_id: string | null
  created_at: string | null
  metadata: ActivityMetadata | null
}

export type GoogleAdsMissedCallTaskResult = {
  id: string
  leadId: string | null
  status: 'callback_started' | 'skipped' | 'failed'
  reason?: string
  callbackStarted?: boolean
  callbackSid?: string
  callbackError?: string
}

export type GoogleAdsMissedCallReconciliationResult = {
  ok: boolean
  dryRun: boolean
  now: string
  scanned: number
  twilioScanned: number
  twilioRepaired: number
  twilioSkippedTest: number
  twilioFailed: number
  processed: number
  callbacksStarted: number
  skippedResponded: number
  skippedInvalid: number
  failed: number
  results: GoogleAdsMissedCallTaskResult[]
}

export type GoogleAdsMissedCallReconciliationOptions = {
  dryRun?: boolean
  limit?: number
  scanTwilioCalls?: boolean
  twilioLookbackMinutes?: number
  now?: Date
}

type TwilioInboundCallRow = {
  sid: string
  from: string
  to: string
  status: string
  duration: number
  startTime: string
}

type TwilioReconciliationResult = {
  callSid: string
  from: string
  to: string
  status: 'ok' | 'repaired' | 'skipped' | 'failed'
  reason?: string
  leadId?: string | null
}

type TaskProcessorDeps = {
  getLeadStation: (leadId: string) => Promise<string | null>
  hasRespondedSince: (leadId: string, sinceIso: string) => Promise<boolean>
  notifyTeam: typeof notifyGoogleAdsTeam
  startCallback: typeof startGoogleAdsAgentCallback
  routingFor: typeof getAgentRouting
  updateTask: (id: string, metadata: ActivityMetadata) => Promise<void>
}

function asRecord(value: unknown): ActivityMetadata {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as ActivityMetadata
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function clampLimit(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)))
}

function clampLookbackMinutes(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30
  return Math.max(5, Math.min(14 * 24 * 60, Math.floor(parsed)))
}

function routeFromMetadata(metadata: ActivityMetadata, routingFor: typeof getAgentRouting): AgentRouting {
  const calledNumber = text(metadata.called_number) || text(metadata.calledNumber) || GOOGLE_ADS_PHONE_NUMBER
  const routing = routingFor(calledNumber)
  const primaryName = text(metadata.primary_agent_name)
  const primaryPhone = text(metadata.primary_agent_phone)
  const secondaryName = text(metadata.secondary_agent_name)
  const secondaryPhone = text(metadata.secondary_agent_phone)

  return {
    ...routing,
    primary: {
      ...routing.primary,
      ...(primaryName ? { name: primaryName } : {}),
      ...(primaryPhone ? { phone: primaryPhone } : {}),
    },
    secondary: {
      ...routing.secondary,
      ...(secondaryName ? { name: secondaryName } : {}),
      ...(secondaryPhone ? { phone: secondaryPhone } : {}),
    },
  }
}

export function isGoogleAdsMissedCallTaskDue(row: GoogleAdsMissedCallTaskRow, now: Date): boolean {
  const metadata = asRecord(row.metadata)
  if (text(metadata.task_type) !== 'google_ads_missed_call_escalation') return false
  if (text(metadata.status).toLowerCase() !== 'pending') return false

  const dueDate = text(metadata.due_date)
  if (!dueDate) return true
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return true
  return due.getTime() <= now.getTime()
}

export async function processGoogleAdsMissedCallTask(
  row: GoogleAdsMissedCallTaskRow,
  input: {
    now: Date
    dryRun: boolean
    deps: TaskProcessorDeps
  },
): Promise<GoogleAdsMissedCallTaskResult> {
  const metadata = asRecord(row.metadata)
  const leadId = text(row.lead_id)
  const sellerPhone = text(metadata.seller_phone) || text(metadata.from)
  const calledNumber = text(metadata.called_number) || text(metadata.calledNumber) || GOOGLE_ADS_PHONE_NUMBER
  const missedAt = text(metadata.missed_at) || row.created_at || input.now.toISOString()

  if (!leadId || !sellerPhone) {
    const nextMetadata = {
      ...metadata,
      status: 'skipped',
      skipped_at: input.now.toISOString(),
      skipped_reason: !leadId ? 'missing_lead_id' : 'missing_seller_phone',
      processed_by: 'google_ads_missed_call_reconciliation',
    }
    if (!input.dryRun) await input.deps.updateTask(row.id, nextMetadata)
    return {
      id: row.id,
      leadId: leadId || null,
      status: 'skipped',
      reason: String(nextMetadata.skipped_reason),
    }
  }

  if (isInternalTestPhone(sellerPhone)) {
    const nextMetadata = {
      ...metadata,
      status: 'skipped',
      skipped_at: input.now.toISOString(),
      skipped_reason: 'internal_test_phone',
      processed_by: 'google_ads_missed_call_reconciliation',
    }
    if (!input.dryRun) await input.deps.updateTask(row.id, nextMetadata)
    return {
      id: row.id,
      leadId,
      status: 'skipped',
      reason: 'internal_test_phone',
    }
  }

  const leadStation = await input.deps.getLeadStation(leadId)
  if (leadStation && ESCALATION_SKIP_STATIONS.has(leadStation.toLowerCase())) {
    const nextMetadata = {
      ...metadata,
      status: 'skipped',
      skipped_at: input.now.toISOString(),
      skipped_reason: `lead_station_${leadStation}`,
      processed_by: 'google_ads_missed_call_reconciliation',
    }
    if (!input.dryRun) await input.deps.updateTask(row.id, nextMetadata)
    return {
      id: row.id,
      leadId,
      status: 'skipped',
      reason: String(nextMetadata.skipped_reason),
    }
  }

  const responded = await input.deps.hasRespondedSince(leadId, missedAt)
  if (responded) {
    const nextMetadata = {
      ...metadata,
      status: 'completed',
      completed_at: input.now.toISOString(),
      skipped_reason: 'lead_responded_before_escalation',
      processed_by: 'google_ads_missed_call_reconciliation',
    }
    if (!input.dryRun) await input.deps.updateTask(row.id, nextMetadata)
    return {
      id: row.id,
      leadId,
      status: 'skipped',
      reason: 'lead_responded_before_escalation',
    }
  }

  const routing = routeFromMetadata(metadata, input.deps.routingFor)
  const reminder = googleAdsEscalationReminderMessage(sellerPhone, leadId, calledNumber)
  const callbackInput = {
    leadId,
    leadPhone: sellerPhone,
    calledNumber,
    agentName: routing.primary.name,
    agentPhone: routing.primary.phone,
    triggerCallSid: text(metadata.callSid),
  }

  if (input.dryRun) {
    return {
      id: row.id,
      leadId,
      status: 'callback_started',
      reason: 'dry_run',
      callbackStarted: true,
    }
  }

  await input.deps.notifyTeam(reminder, {
    leadId,
    routing,
    trigger: 'google_ads_missed_call_escalation_reminder',
    calledNumber,
    metadata: {
      task_id: row.id,
      processed_by: 'google_ads_missed_call_reconciliation',
    },
  })

  const callback = await input.deps.startCallback(callbackInput)
  const nextMetadata = {
    ...metadata,
    status: 'completed',
    completed_at: input.now.toISOString(),
    reminder_sent_at: input.now.toISOString(),
    callback_started: callback.started,
    callback_sid: callback.sid,
    callback_error: callback.error,
    processed_by: 'google_ads_missed_call_reconciliation',
    reconciliation_attempts: (numberValue(metadata.reconciliation_attempts) ?? 0) + 1,
  }
  await input.deps.updateTask(row.id, nextMetadata)

  return {
    id: row.id,
    leadId,
    status: callback.started ? 'callback_started' : 'failed',
    callbackStarted: callback.started,
    callbackSid: callback.sid,
    callbackError: callback.error,
  }
}

async function fetchPendingTasks(limit: number, now: Date): Promise<GoogleAdsMissedCallTaskRow[]> {
  const { data, error } = await supabase
    .from('lead_activities')
    .select('id, lead_id, created_at, metadata')
    .eq('activity_type', 'task')
    .eq('metadata->>task_type', 'google_ads_missed_call_escalation')
    .eq('metadata->>status', 'pending')
    .lte('metadata->>due_date', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)
  return (data ?? []) as GoogleAdsMissedCallTaskRow[]
}

async function updateTask(id: string, metadata: ActivityMetadata): Promise<void> {
  const { error } = await supabase
    .from('lead_activities')
    .update({ metadata })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

async function getLeadStation(leadId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('station')
    .eq('id', leadId)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return text(data?.station)
}

async function fetchRecentTwilioInboundCalls(now: Date, lookbackMinutes: number): Promise<TwilioInboundCallRow[]> {
  const client = getTwilioClient()
  if (!client) return []

  const startTimeAfter = new Date(now.getTime() - lookbackMinutes * 60 * 1000)
  const rows: TwilioInboundCallRow[] = []

  for (const profile of GOOGLE_ADS_PHONE_PROFILES) {
    const calls = await client.calls.list({
      to: profile.number,
      startTimeAfter,
      limit: 100,
    })

    for (const call of calls) {
      if (call.direction && !String(call.direction).includes('inbound')) continue
      rows.push({
        sid: call.sid,
        from: call.from || '',
        to: call.to || profile.number,
        status: call.status || '',
        duration: Number(call.duration || 0),
        startTime: call.startTime instanceof Date ? call.startTime.toISOString() : new Date(call.startTime || now).toISOString(),
      })
    }
  }

  return rows
}

async function hasActivityForCallSid(callSid: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('lead_activities')
    .select('id')
    .or([
      `metadata->>callSid.eq.${callSid}`,
      `metadata->>CallSid.eq.${callSid}`,
      `metadata->>parent_call_sid.eq.${callSid}`,
      `metadata->>parentCallSid.eq.${callSid}`,
      `metadata->>call_sid.eq.${callSid}`,
    ].join(','))
    .limit(1)

  if (error) throw new Error(error.message)
  return Boolean(data?.length)
}

async function findLeadIdByPhone(phone: string): Promise<string | null> {
  for (const variant of phoneLookupVariants(phone)) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, source')
      .eq('phone', variant)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data?.id) return data.id
  }

  return null
}

async function reconcileTwilioInboundCall(
  call: TwilioInboundCallRow,
  input: { dryRun: boolean; now: Date },
): Promise<TwilioReconciliationResult> {
  if (!call.from || !call.to || !call.sid) {
    return { callSid: call.sid, from: call.from, to: call.to, status: 'skipped', reason: 'missing_call_identity' }
  }

  const callStatus = call.status.toLowerCase()
  if (callStatus && !TERMINAL_TWILIO_CALL_STATUSES.has(callStatus)) {
    return { callSid: call.sid, from: call.from, to: call.to, status: 'skipped', reason: 'non_terminal_call_status' }
  }

  if (isInternalTestPhone(call.from)) {
    return { callSid: call.sid, from: call.from, to: call.to, status: 'skipped', reason: 'internal_test_phone' }
  }

  const profile = getGoogleAdsPhoneProfile(call.to)
  if (!profile) {
    return { callSid: call.sid, from: call.from, to: call.to, status: 'skipped', reason: 'not_google_ads_tracking_number' }
  }

  const existingLeadId = await findLeadIdByPhone(call.from)
  const hasActivity = await hasActivityForCallSid(call.sid)
  if (existingLeadId && hasActivity) {
    return { callSid: call.sid, from: call.from, to: call.to, status: 'ok', leadId: existingLeadId }
  }

  if (input.dryRun) {
    return {
      callSid: call.sid,
      from: call.from,
      to: call.to,
      status: 'repaired',
      reason: existingLeadId ? 'dry_run_missing_activity' : 'dry_run_missing_lead',
      leadId: existingLeadId,
    }
  }

  const lead = await resolveGoogleAdsLeadContext(call.from, call.to)
  const leadId = lead.leadId

  if (leadId && !hasActivity) {
    const description = `Reconciled Google Ads call from ${callerPhoneLabel(call.from)} (${call.duration}s)`
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'call',
      description,
      agent: 'System',
      metadata: {
        source: 'google_ads_call_reconciliation',
        traffic_source: 'google_ads',
        campaign: profile.campaign,
        lead_source: profile.source,
        tracking_number: profile.trackingDigits,
        outcome: call.status === 'completed' ? 'completed' : call.status,
        direction: 'inbound',
        from: call.from,
        calledNumber: call.to,
        callSid: call.sid,
        duration: call.duration,
        startTime: call.startTime,
        processed_by: 'google_ads_missed_call_reconciliation',
        repaired_at: input.now.toISOString(),
      },
    })
  }

  await notifyGoogleAdsTeam(
    googleAdsNewCallTeamMessage(call.from, leadId, call.to),
    {
      leadId,
      trigger: 'google_ads_twilio_reconciliation_repaired',
      metadata: {
        from: call.from,
        calledNumber: call.to,
        callSid: call.sid,
        source: 'google_ads_call_reconciliation',
        repaired_missing: existingLeadId ? 'activity' : 'lead',
      },
      now: input.now,
    },
  )

  return {
    callSid: call.sid,
    from: call.from,
    to: call.to,
    status: 'repaired',
    reason: existingLeadId ? 'missing_activity' : 'missing_lead',
    leadId,
  }
}

async function reconcileRecentTwilioInboundCalls(
  input: { dryRun: boolean; now: Date; lookbackMinutes: number },
): Promise<TwilioReconciliationResult[]> {
  const calls = await fetchRecentTwilioInboundCalls(input.now, input.lookbackMinutes)
  const results: TwilioReconciliationResult[] = []

  for (const call of calls) {
    try {
      results.push(await reconcileTwilioInboundCall(call, input))
    } catch (error) {
      results.push({
        callSid: call.sid,
        from: call.from,
        to: call.to,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}

export async function runGoogleAdsMissedCallReconciliation(
  options: GoogleAdsMissedCallReconciliationOptions = {},
): Promise<GoogleAdsMissedCallReconciliationResult> {
  const now = options.now ?? new Date()
  const dryRun = Boolean(options.dryRun)
  const limit = clampLimit(options.limit)
  const scanTwilioCalls = options.scanTwilioCalls ?? true
  const twilioLookbackMinutes = clampLookbackMinutes(options.twilioLookbackMinutes)
  const rows = (await fetchPendingTasks(limit, now)).filter((row) => isGoogleAdsMissedCallTaskDue(row, now))
  const results: GoogleAdsMissedCallTaskResult[] = []

  for (const row of rows) {
    try {
      const result = await processGoogleAdsMissedCallTask(row, {
        now,
        dryRun,
        deps: {
          getLeadStation,
          hasRespondedSince: hasGoogleAdsLeadRespondedSince,
          notifyTeam: notifyGoogleAdsTeam,
          startCallback: startGoogleAdsAgentCallback,
          routingFor: getAgentRouting,
          updateTask,
        },
      })
      results.push(result)
    } catch (error) {
      results.push({
        id: row.id,
        leadId: row.lead_id,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const twilioResults = scanTwilioCalls
    ? await reconcileRecentTwilioInboundCalls({ dryRun, now, lookbackMinutes: twilioLookbackMinutes })
    : []

  return {
    ok: true,
    dryRun,
    now: now.toISOString(),
    scanned: rows.length,
    twilioScanned: twilioResults.length,
    twilioRepaired: twilioResults.filter((result) => result.status === 'repaired').length,
    twilioSkippedTest: twilioResults.filter((result) => result.reason === 'internal_test_phone').length,
    twilioFailed: twilioResults.filter((result) => result.status === 'failed').length,
    processed: results.filter((result) => result.status === 'callback_started').length,
    callbacksStarted: results.filter((result) => result.callbackStarted).length,
    skippedResponded: results.filter((result) => result.reason === 'lead_responded_before_escalation').length,
    skippedInvalid: results.filter((result) => result.status === 'skipped' && result.reason !== 'lead_responded_before_escalation').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  }
}
