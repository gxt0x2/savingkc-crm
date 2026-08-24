import { randomUUID } from 'node:crypto'
import { isWithinProspectingWindow, nextProspectingWindow, renderProspectingTemplate } from '@/lib/prospecting/campaign-contract'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { resolveSmsCaps } from '@/lib/twilio-a2p'
import { supabase } from '@/lib/supabase-lazy'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

function deliveryStatusCallback(actionId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
  const url = new URL('/api/twilio-message-status', base)
  url.searchParams.set('action_id', actionId)
  url.hash = 'rc=3&rp=5xx,ct,rt&ct=2000&rt=5000'
  return url.toString()
}

type ClaimedCampaignAction = {
  id: string
  campaignId: string
  memberId: string
  stepId: string
  subjectKind: 'lead' | 'prospect'
  leadId: string | null
  prospectId: string | null
  prospectPhoneId: string | null
  attemptCount: number
  phone: string
  timezone: string
  bodyTemplate: string
  fromPhone: string
  sendWindowStart: string
  sendWindowEnd: string
  sendDays: number[]
  perHour: number
  perDay: number
  ownerName: string
}

type WorkerSummary = { processed: number; sent: number; deferred: number; blocked: number; failed: number }

function validClaim(value: unknown): value is ClaimedCampaignAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string'
    && typeof row.campaignId === 'string'
    && typeof row.memberId === 'string'
    && typeof row.stepId === 'string'
    && (row.subjectKind === 'lead' || row.subjectKind === 'prospect')
    && (typeof row.leadId === 'string' || row.leadId === null)
    && (typeof row.prospectId === 'string' || row.prospectId === null)
    && (typeof row.prospectPhoneId === 'string' || row.prospectPhoneId === null)
    && ((row.subjectKind === 'lead' && typeof row.leadId === 'string' && row.prospectId === null)
      || (row.subjectKind === 'prospect' && row.leadId === null && typeof row.prospectId === 'string'))
    && typeof row.phone === 'string'
    && typeof row.timezone === 'string'
    && typeof row.bodyTemplate === 'string'
    && typeof row.fromPhone === 'string'
    && typeof row.sendWindowStart === 'string'
    && typeof row.sendWindowEnd === 'string'
    && Array.isArray(row.sendDays)
    && row.sendDays.every((day) => Number.isInteger(day))
    && Number.isInteger(row.attemptCount)
    && Number.isInteger(row.perHour)
    && Number.isInteger(row.perDay)
}

async function finishAction(
  action: ClaimedCampaignAction,
  workerToken: string,
  result: 'sent' | 'blocked' | 'failed' | 'deferred',
  detail: { renderedBody?: string; providerSid?: string; errorCode?: string; retryAt?: string } = {},
) {
  const response = await supabase.rpc('finish_prospecting_campaign_action_v1', {
    p_action_id: action.id,
    p_worker_token: workerToken,
    p_result: result,
    p_rendered_body: detail.renderedBody || null,
    p_provider_sid: detail.providerSid || null,
    p_error_code: detail.errorCode || null,
    p_retry_at: detail.retryAt || null,
  })
  if (response.error) throw response.error
}

async function processAction(action: ClaimedCampaignAction, workerToken: string): Promise<keyof Omit<WorkerSummary, 'processed'>> {
  const window = {
    timezone: action.timezone,
    sendWindowStart: action.sendWindowStart,
    sendWindowEnd: action.sendWindowEnd,
    sendDays: action.sendDays,
  }
  const now = new Date()
  if (!isWithinProspectingWindow(now, window)) {
    await finishAction(action, workerToken, 'deferred', {
      errorCode: 'outside_contact_window',
      retryAt: nextProspectingWindow(now, window).toISOString(),
    })
    return 'deferred'
  }

  let fullName = ''
  let propertyAddress = ''
  if (action.subjectKind === 'lead' && action.leadId) {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id,full_name,property_address')
      .eq('id', action.leadId)
      .maybeSingle()
    if (leadError) throw leadError
    if (!lead) {
      await finishAction(action, workerToken, 'blocked', { errorCode: 'lead_not_found' })
      return 'blocked'
    }
    fullName = String(lead.full_name || '')
    propertyAddress = String(lead.property_address || '')
  } else if (action.subjectKind === 'prospect' && action.prospectId) {
    const { data: prospect, error: prospectError } = await supabase
      .from('prospects')
      .select('id,owner_1,situs_street,situs_city,situs_state,situs_zip')
      .eq('id', action.prospectId)
      .maybeSingle()
    if (prospectError) throw prospectError
    if (!prospect) {
      await finishAction(action, workerToken, 'blocked', { errorCode: 'prospect_not_found' })
      return 'blocked'
    }
    fullName = String(prospect.owner_1 || '')
    propertyAddress = [prospect.situs_street, prospect.situs_city, prospect.situs_state, prospect.situs_zip]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(', ')
  }

  const body = renderProspectingTemplate(action.bodyTemplate, {
    fullName,
    propertyAddress,
    agentName: action.ownerName,
  })
  if (!body) {
    await finishAction(action, workerToken, 'blocked', { errorCode: 'invalid_rendered_message' })
    return 'blocked'
  }

  // Reserve immediately before the provider call. The RPC rechecks campaign,
  // member, and claim state under a row lock, so a pause, reply, or STOP that
  // landed during hydration prevents the send.
  const caps = await resolveSmsCaps()
  const perHour = Math.max(1, Math.min(action.perHour, caps.perHour))
  const perDay = Math.max(1, Math.min(action.perDay, caps.perDay))
  const reservation = await supabase.rpc('reserve_prospecting_sms_send_v1', {
    p_action_id: action.id,
    p_worker_token: workerToken,
    p_per_hour: perHour,
    p_per_day: perDay,
  })
  if (reservation.error) throw reservation.error
  if (!(reservation.data as { reserved?: unknown } | null)?.reserved) {
    await finishAction(action, workerToken, 'deferred', {
      errorCode: 'send_budget_exhausted',
      retryAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    })
    return 'deferred'
  }

  const normalizedPhone = normalizePhoneToE164(action.phone)
  const send = await sendLeadSms({
    leadId: action.leadId,
    phone: action.phone,
    body,
    fromPhone: action.fromPhone,
    agent: action.ownerName,
    source: 'prospecting_campaign',
    metadata: {
      prospecting_campaign_id: action.campaignId,
      prospecting_campaign_member_id: action.memberId,
      prospecting_campaign_action_id: action.id,
      prospecting_campaign_step_id: action.stepId,
      subject_kind: action.subjectKind,
      prospect_id: action.prospectId,
      prospect_phone_id: action.prospectPhoneId,
      ...(action.leadId
        ? { thread_key: `lead:${action.leadId}` }
        : normalizedPhone
          ? { thread_key: `phone:${normalizedPhone}` }
          : {}),
    },
    statusCallback: deliveryStatusCallback(action.id),
  })

  if (send.status === 'skipped' && send.reason === 'opted_out') {
    await finishAction(action, workerToken, 'blocked', { renderedBody: body, errorCode: 'do_not_contact' })
    return 'blocked'
  }
  if (send.status === 'skipped') {
    // The canonical sender found the same body inside its 24-hour safety
    // window. Treat the campaign step as satisfied instead of retrying it and
    // risking a duplicate after the window expires. The original delivery is
    // already present in lead_activities/sms_delivery_log.
    await finishAction(action, workerToken, 'sent', {
      renderedBody: body,
      errorCode: 'deduplicated_existing_send',
    })
    return 'sent'
  }
  if (send.status === 'failed') {
    await finishAction(action, workerToken, 'failed', { renderedBody: body, errorCode: 'provider_send_failed' })
    return 'failed'
  }

  await finishAction(action, workerToken, 'sent', {
    renderedBody: body,
    providerSid: send.sid,
    errorCode: send.persisted ? undefined : 'delivered_not_persisted',
  })
  return 'sent'
}

export async function processProspectingCampaignActions(requestedLimit = 10): Promise<WorkerSummary> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), 25))
  const workerToken = randomUUID()
  const summary: WorkerSummary = { processed: 0, sent: 0, deferred: 0, blocked: 0, failed: 0 }

  for (let index = 0; index < limit; index += 1) {
    const claim = await supabase.rpc('claim_prospecting_campaign_action_v1', {
      p_worker_token: workerToken,
      p_lease_seconds: 120,
    })
    if (claim.error) throw claim.error
    if (claim.data == null) break
    if (!validClaim(claim.data)) throw new Error('Invalid prospecting campaign action claim')
    summary.processed += 1
    try {
      const result = await processAction(claim.data, workerToken)
      summary[result] += 1
    } catch (error) {
      console.error('[prospecting-worker] Campaign action failed', { actionId: claim.data.id, error })
      try {
        await finishAction(claim.data, workerToken, 'failed', { errorCode: 'worker_runtime_error' })
      } catch (finishError) {
        console.error('[prospecting-worker] Could not release campaign action claim', { actionId: claim.data.id, finishError })
      }
      summary.failed += 1
    }
  }
  return summary
}
