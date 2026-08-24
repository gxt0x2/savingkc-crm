import {
  GOOGLE_ADS_PHONE_PROFILES,
  getGoogleAdsPhoneProfile,
} from '@/lib/call-quality-events'
import { isInternalTestPhone } from '@/lib/internal-test-phones'
import {
  callerPhoneLabel,
  googleAdsNewCallTeamMessage,
  notifyGoogleAdsTeam,
  phoneLookupVariants,
  resolveGoogleAdsLeadContext,
} from '@/lib/google-ads-phone'
import { getTwilioClient } from '@/lib/safe-communications'
import { supabase } from '@/lib/supabase-lazy'

const TERMINAL_TWILIO_CALL_STATUSES = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled'])

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
  attachedActivityCount?: number
}

function clampLookbackMinutes(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30
  return Math.max(5, Math.min(14 * 24 * 60, Math.floor(parsed)))
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

export function googleAdsCallSidActivityOrFilter(callSid: string): string {
  return [
    `metadata->>callSid.eq.${callSid}`,
    `metadata->>CallSid.eq.${callSid}`,
    `metadata->>parent_call_sid.eq.${callSid}`,
    `metadata->>parentCallSid.eq.${callSid}`,
    `metadata->>call_sid.eq.${callSid}`,
  ].join(',')
}

async function hasActivityForCallSid(callSid: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('lead_activities')
    .select('id')
    .or(googleAdsCallSidActivityOrFilter(callSid))
    .limit(1)

  if (error) throw new Error(error.message)
  return Boolean(data?.length)
}

async function attachLeadActivitiesForCallSid(callSid: string, leadId: string): Promise<number> {
  const { count, error } = await supabase
    .from('lead_activities')
    .update({ lead_id: leadId }, { count: 'exact' })
    .is('lead_id', null)
    .or(googleAdsCallSidActivityOrFilter(callSid))

  if (error) throw new Error(error.message)
  return count ?? 0
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
  let attachedActivityCount = 0

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
  } else if (leadId && hasActivity && !existingLeadId) {
    attachedActivityCount = await attachLeadActivitiesForCallSid(call.sid, leadId)
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
        attached_activity_count: attachedActivityCount,
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
    attachedActivityCount,
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
  const scanTwilioCalls = options.scanTwilioCalls ?? true
  const twilioLookbackMinutes = clampLookbackMinutes(options.twilioLookbackMinutes)

  const twilioResults = scanTwilioCalls
    ? await reconcileRecentTwilioInboundCalls({ dryRun, now, lookbackMinutes: twilioLookbackMinutes })
    : []

  return {
    ok: true,
    dryRun,
    now: now.toISOString(),
    // Retain the response fields for monitoring compatibility. Automatic callback
    // tasks are intentionally retired; Conversations owns missed-call actionability.
    scanned: 0,
    twilioScanned: twilioResults.length,
    twilioRepaired: twilioResults.filter((result) => result.status === 'repaired').length,
    twilioSkippedTest: twilioResults.filter((result) => result.reason === 'internal_test_phone').length,
    twilioFailed: twilioResults.filter((result) => result.status === 'failed').length,
    processed: 0,
    callbacksStarted: 0,
    skippedResponded: 0,
    skippedInvalid: 0,
    failed: 0,
    results: [],
  }
}
