import { getAgentRouting, type AgentRouting } from '@/lib/agent-routing'
import { GOOGLE_ADS_PHONE_NUMBER } from '@/lib/call-quality-events'
import {
  googleAdsEscalationReminderMessage,
  hasGoogleAdsLeadRespondedSince,
  notifyGoogleAdsTeam,
  startGoogleAdsAgentCallback,
} from '@/lib/google-ads-phone'
import { supabase } from '@/lib/supabase-lazy'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

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
  now?: Date
}

type TaskProcessorDeps = {
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
  const reminder = googleAdsEscalationReminderMessage(sellerPhone, leadId)
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

export async function runGoogleAdsMissedCallReconciliation(
  options: GoogleAdsMissedCallReconciliationOptions = {},
): Promise<GoogleAdsMissedCallReconciliationResult> {
  const now = options.now ?? new Date()
  const dryRun = Boolean(options.dryRun)
  const limit = clampLimit(options.limit)
  const rows = (await fetchPendingTasks(limit, now)).filter((row) => isGoogleAdsMissedCallTaskDue(row, now))
  const results: GoogleAdsMissedCallTaskResult[] = []

  for (const row of rows) {
    try {
      const result = await processGoogleAdsMissedCallTask(row, {
        now,
        dryRun,
        deps: {
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

  return {
    ok: true,
    dryRun,
    now: now.toISOString(),
    scanned: rows.length,
    processed: results.filter((result) => result.status === 'callback_started').length,
    callbacksStarted: results.filter((result) => result.callbackStarted).length,
    skippedResponded: results.filter((result) => result.reason === 'lead_responded_before_escalation').length,
    skippedInvalid: results.filter((result) => result.status === 'skipped' && result.reason !== 'lead_responded_before_escalation').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  }
}
