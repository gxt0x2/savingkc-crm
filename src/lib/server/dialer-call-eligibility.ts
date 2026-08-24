import type { SupabaseClient } from '@supabase/supabase-js'
import {
  dialerCallBlock,
  evaluateDialerCallPolicy,
  phoneLookupVariants,
  type DialerActivityPolicyFact,
  type DialerCallBlockReason,
  type DialerCallDecision,
} from '@/lib/dialer-call-policy'
import { normalizeDisposition } from '@/lib/dialer-dispositions'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { supabase } from '@/lib/supabase-lazy'
import { stableWebhookActivityId } from '@/lib/telephony/webhook-idempotency'
import { isDialerCallerIdNumber, TWILIO_NUMBERS } from '@/lib/twilio-numbers'

export const DIALER_POLICY_VERSION = 'dialer_safety_v1' as const

export type OutboundDialerCallSource =
  | 'web_manual'
  | 'web_click_to_call'
  | 'web_recent_redial'
  | 'web_power_dialer'
  | 'web_heir_dialer'
  | 'mobile_manual'
  | 'mobile_lead'
  | 'form_lead_callback'
  | 'google_ads_callback'
  | 'legacy_sdk'

export interface OutboundDialerCallInput {
  phone: string
  leadId?: string | null
  prospectPhoneId?: string | null
  source: OutboundDialerCallSource
  identity?: string | null
  callerId?: string | null
  callSid?: string | null
  clientAttemptId?: string | null
  now?: Date
}

export type OutboundDialerCallDecision = DialerCallDecision & {
  policyVersion: typeof DIALER_POLICY_VERSION
  checkedAt: string
  leadId: string | null
  prospectPhoneId: string | null
  reasonSource?: string
}

type LeadRow = {
  id: string
  phone: string | null
  station: string | null
  classification: string | null
}

type ProspectPhoneRow = {
  id: string
  phone: string | null
  prospect_id: string | null
  phone_connected: boolean | string | null
  last_disposition: string | null
  prospects?: { lead_id?: string | null } | Array<{ lead_id?: string | null }> | null
}

type ActivityRow = { lead_id: string | null; activity_type: string; metadata: unknown; created_at: string }
type SuppressionRow = { phone: string | null; reason: string | null }

const VALID_SOURCES = new Set<OutboundDialerCallSource>([
  'web_manual',
  'web_click_to_call',
  'web_recent_redial',
  'web_power_dialer',
  'web_heir_dialer',
  'mobile_manual',
  'mobile_lead',
  'form_lead_callback',
  'google_ads_callback',
  'legacy_sdk',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function linkedLeadId(row: ProspectPhoneRow): string | null {
  if (Array.isArray(row.prospects)) return stringValue(row.prospects[0]?.lead_id)
  return stringValue(row.prospects?.lead_id)
}

function prospectPhonesForLead(
  exact: ProspectPhoneRow | null,
  matches: ProspectPhoneRow[],
  leadId: string,
  target: string,
): boolean {
  return [
    ...(exact ? [exact] : []),
    ...matches,
  ].some((row) => (
    linkedLeadId(row) === leadId
    && normalizePhoneToE164(row.phone) === target
  ))
}

function uniqueById<T extends { id: string }>(rows: readonly T[]): T[] {
  return Array.from(new Map(rows.map((row) => [row.id, row])).values())
}

function decision(
  value: DialerCallDecision,
  input: { checkedAt: string; leadId?: string | null; prospectPhoneId?: string | null; reasonSource?: string },
): OutboundDialerCallDecision {
  return {
    ...value,
    policyVersion: DIALER_POLICY_VERSION,
    checkedAt: input.checkedAt,
    leadId: input.leadId ?? null,
    prospectPhoneId: input.prospectPhoneId ?? null,
    ...(input.reasonSource ? { reasonSource: input.reasonSource } : {}),
  }
}

function policyUnavailable(input: OutboundDialerCallInput, checkedAt: string): OutboundDialerCallDecision {
  return decision(dialerCallBlock('policy_unavailable', normalizePhoneToE164(input.phone)), {
    checkedAt,
    leadId: input.leadId,
    prospectPhoneId: input.prospectPhoneId,
    reasonSource: 'policy_runtime',
  })
}

function activityFact(row: ActivityRow, target: string, prospectPhoneId: string | null): DialerActivityPolicyFact | null {
  if (!isRecord(row.metadata)) return null
  const metadataProspectPhoneId = stringValue(row.metadata.prospect_phone_id)
  const phoneValues = [row.metadata.phone, row.metadata.to, row.metadata.destination]
    .map((value) => normalizePhoneToE164(stringValue(value)))
    .filter((value): value is string => Boolean(value))
  const matches = phoneValues.includes(target)
    || Boolean(prospectPhoneId && metadataProspectPhoneId === prospectPhoneId)
  if (!matches) return null

  return {
    disposition: stringValue(row.metadata.disposition),
    outcome: stringValue(row.metadata.outcome),
    phone_status: stringValue(row.metadata.phone_status),
  }
}

function dispositionReason(raw: string | null | undefined): DialerCallBlockReason | null {
  const normalized = normalizeDisposition(raw)
  if (normalized === 'dnc') return 'do_not_call'
  if (normalized === 'wrong_number') return 'wrong_number'
  if (normalized === 'disconnected') return 'disconnected'
  return null
}

function phoneStatusReason(raw: string | null | undefined): DialerCallBlockReason | null {
  const value = raw?.trim().toLowerCase()
  if (value === 'dnc') return 'do_not_call'
  if (value === 'wrong_number') return 'wrong_number'
  if (value === 'disconnected') return 'disconnected'
  if (value === 'spam' || value === 'blocked') return 'blocked_number'
  return null
}

function exactReasonSource(input: {
  result: DialerCallDecision
  suppressions: SuppressionRow[]
  leads: LeadRow[]
  prospectPhones: ProspectPhoneRow[]
  activities: DialerActivityPolicyFact[]
}): string | undefined {
  if (input.result.allowed) return undefined
  const reason = input.result.reason
  if (reason === 'outside_calling_hours') return 'calling_hours'
  if (reason === 'internal_destination') return 'internal_numbers'
  if (input.suppressions.length > 0) return 'sms_opt_outs.reason'

  if (reason === 'dead_lead') {
    if (input.leads.some((lead) => ['dead', 'closed_lost'].includes(lead.station?.toLowerCase() ?? ''))) return 'leads.station'
    if (input.leads.some((lead) => lead.classification?.toLowerCase() === 'dead')) return 'leads.classification'
  }

  const stoppedProspect = input.prospectPhones.find((row) => {
    const connection = String(row.phone_connected ?? '').toLowerCase()
    return (reason === 'disconnected' && ['false', 'disconnected'].includes(connection))
      || dispositionReason(row.last_disposition) === reason
  })
  if (stoppedProspect) {
    const connection = String(stoppedProspect.phone_connected ?? '').toLowerCase()
    return reason === 'disconnected' && ['false', 'disconnected'].includes(connection)
      ? 'prospect_phones.phone_connected'
      : 'prospect_phones.last_disposition'
  }

  const activity = input.activities.find((fact) => (
    dispositionReason(fact.disposition) === reason
    || dispositionReason(fact.outcome) === reason
    || (reason === 'disconnected' && fact.outcome === 'bad_number')
    || phoneStatusReason(fact.phone_status) === reason
  ))
  if (activity) {
    if (activity.phone_status) return 'lead_activities.metadata.phone_status'
    if (activity.outcome) return 'lead_activities.metadata.outcome'
    return 'lead_activities.metadata.disposition'
  }

  return 'contact_policy_records'
}

async function matchingRows<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  variants: string[],
): Promise<T[]> {
  const { data, error } = await db.from(table).select(columns).in('phone', variants).limit(1000)
  if (error) throw new Error(`dialer policy ${table} lookup failed`)
  return (data ?? []) as unknown as T[]
}

export function isAllowedDialerCallerId(value: string | null | undefined): boolean {
  const normalized = normalizePhoneToE164(value)
  return Boolean(normalized && isDialerCallerIdNumber(normalized))
}

async function evaluateOutboundDialerCallUnchecked(
  input: OutboundDialerCallInput,
  options: { db?: SupabaseClient } = {},
): Promise<OutboundDialerCallDecision> {
  const checkedAt = (input.now ?? new Date()).toISOString()
  const normalizedPhone = normalizePhoneToE164(input.phone)
  if (!normalizedPhone) {
    return decision(dialerCallBlock('invalid_phone'), { checkedAt, reasonSource: 'phone' })
  }
  if (!VALID_SOURCES.has(input.source)) return policyUnavailable(input, checkedAt)

  const db = options.db ?? supabase
  const variants = phoneLookupVariants(input.phone)
  try {
    const exactLeadPromise = input.leadId
      ? db.from('leads').select('id, phone, station, classification').eq('id', input.leadId).maybeSingle()
      : Promise.resolve({ data: null, error: null })
    const exactProspectPhonePromise = input.prospectPhoneId
      ? db.from('prospect_phones')
        .select('id, phone, prospect_id, phone_connected, last_disposition, prospects(lead_id)')
        .eq('id', input.prospectPhoneId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null })

    const [exactLeadResult, exactProspectPhoneResult, matchedLeads, matchedProspectPhones, suppressions] = await Promise.all([
      exactLeadPromise,
      exactProspectPhonePromise,
      matchingRows<LeadRow>(db, 'leads', 'id, phone, station, classification', variants),
      matchingRows<ProspectPhoneRow>(db, 'prospect_phones', 'id, phone, prospect_id, phone_connected, last_disposition, prospects(lead_id)', variants),
      (async () => {
        const { data, error } = await db
          .from('sms_opt_outs')
          .select('phone, reason')
          .in('phone', variants)
          .eq('is_opted_out', true)
          .limit(1000)
        if (error) throw new Error('dialer policy suppression lookup failed')
        return (data ?? []) as unknown as SuppressionRow[]
      })(),
    ])

    if (exactLeadResult.error || exactProspectPhoneResult.error) throw new Error('dialer policy context lookup failed')
    const exactLead = exactLeadResult.data as unknown as LeadRow | null
    const exactProspectPhone = exactProspectPhoneResult.data as unknown as ProspectPhoneRow | null

    if (input.prospectPhoneId) {
      const prospectMatches = exactProspectPhone
        && normalizePhoneToE164(exactProspectPhone.phone) === normalizedPhone
        && (!input.leadId || linkedLeadId(exactProspectPhone) === input.leadId)
      if (!prospectMatches) {
        return decision(dialerCallBlock('destination_mismatch', normalizedPhone), {
          checkedAt,
          leadId: input.leadId,
          prospectPhoneId: input.prospectPhoneId,
          reasonSource: 'prospect_phone_context',
        })
      }
    }

    if (input.leadId) {
      if (!exactLead) {
        return decision(dialerCallBlock('destination_mismatch', normalizedPhone), {
          checkedAt,
          leadId: input.leadId,
          prospectPhoneId: input.prospectPhoneId,
          reasonSource: 'lead_context',
        })
      }
      const directMatch = normalizePhoneToE164(exactLead.phone) === normalizedPhone
      const heirMatch = prospectPhonesForLead(exactProspectPhone, matchedProspectPhones, input.leadId, normalizedPhone)
      if (!directMatch && !heirMatch) {
        return decision(dialerCallBlock('destination_mismatch', normalizedPhone), {
          checkedAt,
          leadId: input.leadId,
          prospectPhoneId: input.prospectPhoneId,
          reasonSource: 'lead_context',
        })
      }
    }

    const leads = uniqueById([
      ...matchedLeads,
      ...(exactLead ? [exactLead] : []),
    ])
    const prospectPhones = uniqueById([
      ...matchedProspectPhones,
      ...(exactProspectPhone ? [exactProspectPhone] : []),
    ])
    const resolvedLeadIds = Array.from(new Set([
      ...leads.map((lead) => lead.id),
      ...prospectPhones.map(linkedLeadId),
      input.leadId ?? null,
    ].filter((value): value is string => Boolean(value))))

    let activityRows: ActivityRow[] = []
    if (resolvedLeadIds.length > 0) {
      const activityResult = await db.from('lead_activities')
        .select('lead_id, activity_type, metadata, created_at')
        .in('lead_id', resolvedLeadIds)
        .order('created_at', { ascending: false })
        .limit(100)
      if (activityResult.error) throw new Error('dialer policy history lookup failed')
      activityRows = (activityResult.data ?? []) as unknown as ActivityRow[]
    }

    const activityFacts = activityRows
      .map((row) => activityFact(row, normalizedPhone, input.prospectPhoneId ?? null))
      .filter((fact): fact is DialerActivityPolicyFact => Boolean(fact))

    const policyDecision = evaluateDialerCallPolicy({
      phone: normalizedPhone,
      now: input.now,
      leads,
      suppressionReasons: suppressions.map((row) => row.reason),
      prospectPhones,
      activities: activityFacts,
      internalNumbers: [
        ...TWILIO_NUMBERS.map((number) => number.value),
        process.env.ERNEST_PHONE || '+18162262552',
        process.env.CASEY_PHONE || '+18167564943',
      ],
      callingHoursExempt: input.source === 'form_lead_callback' || input.source === 'google_ads_callback',
    })

    const resolvedLeadId = input.leadId ?? leads[0]?.id ?? prospectPhones.map(linkedLeadId).find(Boolean) ?? null
    return decision(policyDecision, {
      checkedAt,
      leadId: resolvedLeadId,
      prospectPhoneId: input.prospectPhoneId ?? exactProspectPhone?.id ?? null,
      reasonSource: exactReasonSource({
        result: policyDecision,
        suppressions,
        leads,
        prospectPhones,
        activities: activityFacts,
      }),
    })
  } catch (error) {
    console.error('[dialer-call-policy] Safety evaluation unavailable', error)
    return policyUnavailable(input, checkedAt)
  }
}

export async function evaluateOutboundDialerCall(
  input: OutboundDialerCallInput,
  options: { db?: SupabaseClient; timeoutMs?: number } = {},
): Promise<OutboundDialerCallDecision> {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 2500, 1), 10_000)
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<OutboundDialerCallDecision>((resolve) => {
    timeoutId = setTimeout(() => {
      console.error('[dialer-call-policy] Safety evaluation timed out')
      resolve(policyUnavailable(input, (input.now ?? new Date()).toISOString()))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      evaluateOutboundDialerCallUnchecked(input, { db: options.db }),
      timeout,
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function recordBlockedDialerCall(
  input: OutboundDialerCallInput,
  result: Extract<OutboundDialerCallDecision, { allowed: false }> | OutboundDialerCallDecision,
  options: { db?: SupabaseClient } = {},
): Promise<void> {
  if (result.allowed) return
  const db = options.db ?? supabase
  const eventKey = input.clientAttemptId?.trim() || input.callSid?.trim() || null
  const payload: Record<string, unknown> = {
    ...(eventKey ? { id: stableWebhookActivityId('outbound-call-blocked', eventKey) } : {}),
    lead_id: result.leadId,
    activity_type: 'call',
    description: `Outbound call blocked before dial: ${result.reason}`,
    agent: input.identity?.trim() || 'System',
    metadata: {
      source: 'outbound_call_policy',
      policy_version: DIALER_POLICY_VERSION,
      event: 'blocked_before_dial',
      direction: 'outbound',
      status: 'blocked',
      reason_code: result.reason,
      reason_source: result.reasonSource ?? null,
      phone: result.normalizedPhone,
      to: result.normalizedPhone,
      lead_id: result.leadId,
      prospect_phone_id: result.prospectPhoneId,
      dial_source: input.source,
      identity: input.identity ?? null,
      caller_id: normalizePhoneToE164(input.callerId),
      call_sid: input.callSid ?? null,
      client_attempt_id: input.clientAttemptId ?? null,
      checked_at: result.checkedAt,
      timezone: 'America/Chicago',
    },
  }

  try {
    const { error } = await db.from('lead_activities').insert(payload)
    if (error && error.code !== '23505') throw error
  } catch (error) {
    console.error('[dialer-call-policy] Failed to persist blocked call audit', error)
  }
}

export function dialerBlockStatus(reason: DialerCallBlockReason): number {
  return reason === 'policy_unavailable' ? 503 : 409
}
