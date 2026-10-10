import { NextResponse } from 'next/server'
import { afterRequest } from '@/lib/after-request'
import { validateTwilioWebhook } from '@/lib/twilio-validate'

export const maxDuration = 60
import { rateLimit, rateLimitConfigs, getClientIp } from '@/middleware/rate-limit'
import { regenerateBriefing } from '@/lib/briefing-regen'
import { sendMobilePushToAgentNames } from '@/lib/mobile-push'
import { sendPushToAgents } from '@/lib/push-notifications'
import { sendPushToAgentNames } from '@/lib/push-notifications'
import { CASEY_COMPANY_NUMBER, getLeadAlertRecipients } from '@/lib/lead-alert-routing'
import { lookupProspectByPhone } from '@/lib/prospect-lookup'
import { createEnrichedLeadFromProspect, formatProspectAlert } from '@/lib/prospect-to-lead'
import type { ProspectMatch } from '@/lib/prospect-lookup'
import { safeSendSMS } from '@/lib/safe-communications'
import { formatPhone } from '@/lib/format'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { processInboundSmsConsent } from '@/lib/sms-consent-audit'
import { supabase } from '@/lib/supabase-lazy'
import { isGoogleAdsPhoneNumber } from '@/lib/call-quality-events'
import { recordAppointmentSmsResponse } from '@/lib/server/appointment-sms-response'
import { resolveInboundSmsLead } from '@/lib/server/inbound-sms-lead'
import { inboundAnswersAutomatedYesPrompt, type ReplyYesPromptDb } from '@/lib/server/reply-yes-prompt'
import {
  googleAdsNewTextTeamMessage,
  markLeadAsGoogleAdsPhoneLead,
  notifyGoogleAdsTeam,
  resolveGoogleAdsLeadContext,
} from '@/lib/google-ads-phone'

const CASEY_PHONE = normalizePhoneToE164(process.env.CASEY_PHONE) || '+18167564943'
const ERNEST_PHONE = normalizePhoneToE164(process.env.ERNEST_PHONE) || '+18162262552'
const TWILIO_PHONE = normalizePhoneToE164(process.env.TWILIO_PHONE_NUMBER) || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const TWIML_HEADERS = { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store, max-age=0' }

function emptyTwimlResponse(status = 200): NextResponse {
  return new NextResponse(EMPTY_TWIML, {
    status,
    headers: TWIML_HEADERS,
  })
}

// Team numbers — never trigger auto-reply flows for these
const TEAM_NUMBERS = new Set([
  '+18167564943', // Casey personal
  '+18167277667', // Casey company
  '+18166088588', // Ernest company
  '+18162262552', // Ernest forwarding
])

type SmsSuppressionReason = 'SPAM' | 'BLOCKED' | 'DNC' | 'WRONG_NUMBER' | string

async function findLeadById(leadId: string) {
  const { data, error } = await supabase.from('leads')
    .select('id, full_name, phone, station, priority')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(`Linked lead lookup failed: ${error.message}`)
  if (!data) throw new Error('Previously linked inbound SMS lead is unavailable')
  return data
}

async function linkInboundActivity(activityId: string, leadId: string, claimId: string): Promise<void> {
  const { data, error } = await supabase.from('lead_activities')
    .update({ lead_id: leadId })
    .eq('id', activityId)
    .eq('metadata->>inbound_processing_claim_id', claimId)
    .eq('metadata->>inbound_processing_state', 'processing')
    .is('lead_id', null)
    .select('id,lead_id')
    .maybeSingle()
  if (error) throw new Error(`Inbound SMS lead link failed: ${error.message}`)
  if (data?.lead_id === leadId) return

  // Another handler may have completed the same null-to-lead link. Verify the
  // persisted relation before treating the inbound activity as linked.
  const verified = await supabase.from('lead_activities')
    .select('id,lead_id')
    .eq('id', activityId)
    .eq('metadata->>inbound_processing_claim_id', claimId)
    .eq('metadata->>inbound_processing_state', 'processing')
    .maybeSingle()
  if (verified.error) throw new Error(`Inbound SMS lead link verification failed: ${verified.error.message}`)
  if (verified.data?.lead_id !== leadId) throw new Error('Inbound SMS activity was not linked to its lead')
}

async function smsSuppressionReason(phone: string): Promise<SmsSuppressionReason | null> {
  const { data } = await supabase
    .from('sms_opt_outs')
    .select('reason')
    .eq('phone', phone)
    .eq('is_opted_out', true)
    .maybeSingle()

  return typeof data?.reason === 'string' ? data.reason.toUpperCase() : null
}

function isHardBlockedReason(reason: SmsSuppressionReason | null): boolean {
  return reason === 'SPAM' || reason === 'BLOCKED'
}

function sendInboundSmsPush(
  to: string,
  payload: Parameters<typeof sendPushToAgents>[0],
  context: { leadId?: string | null; messageSid: string },
) {
  afterRequest(() => {
    const names = getLeadAlertRecipients(new Date(), to).map((recipient) => recipient.name)
    const web = to !== CASEY_COMPANY_NUMBER
      ? sendPushToAgents(payload)
      : sendPushToAgentNames(names, payload)
    const leadId = context.leadId || ''
    const mobile = sendMobilePushToAgentNames(names, {
      title: payload.title,
      body: payload.body,
      data: {
        href: leadId ? `/conversation/${leadId}` : '/conversations',
        kind: 'inbound_sms',
        leadId,
        eventId: `sms_${context.messageSid}`,
      },
    })
    return Promise.all([web, mobile])
  })
}

export async function POST(req: Request) {
  try {
    // Twilio signature validation
    const isValid = await validateTwilioWebhook(req)
    if (!isValid) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // IP-based rate limiting
    const ip = getClientIp(req)
    const { allowed } = rateLimit(ip, rateLimitConfigs.webhook)
    if (!allowed) {
      return new NextResponse('Rate limited', { status: 429 })
    }

    const body = await req.formData()
    const from = body.get('From') as string
    const to = body.get('To') as string
    const messageBody = body.get('Body') as string
    const messageSid = body.get('MessageSid') as string
    const isGoogleAdsSms = isGoogleAdsPhoneNumber(to || '')
    const alertRecipients = getLeadAlertRecipients(new Date(), to)
    const sendAlertSms = (body: string) => Promise.allSettled(
      alertRecipients.map((recipient) => safeSendSMS({ body, from: TWILIO_PHONE, to: recipient.phone })),
    )

    if (!from || !to || messageBody === null || !messageSid) {
      return new NextResponse('Missing required fields', { status: 400 })
    }

    // Twilio retries webhook deliveries. Only a completed MessageSid is
    // terminal; persisted pending work must receive a retryable response or
    // resume processing below.
    const priorMessage = await supabase.from('lead_activities')
      .select('id,lead_id,metadata,created_at')
      .eq('activity_type', 'sms')
      .eq('metadata->>message_sid', messageSid)
      .in('metadata->>direction', ['received', 'inbound', 'in'])
      .limit(1)
      .maybeSingle()
    if (priorMessage.error) {
      console.error('[twilio-sms-webhook] duplicate check failed:', priorMessage.error)
      return emptyTwimlResponse(503)
    }
    const priorMetadata = priorMessage.data?.metadata && typeof priorMessage.data.metadata === 'object'
      ? priorMessage.data.metadata as Record<string, unknown>
      : null
    const priorState = priorMetadata?.inbound_processing_state
    if (priorMessage.data && priorState !== 'pending' && priorState !== 'processing') {
      // Historic rows and explicitly completed deliveries are terminal.
      return emptyTwimlResponse()
    }
    if (priorMessage.data && typeof priorMessage.data.id !== 'string') {
      console.error('[twilio-sms-webhook] persisted inbound SMS is missing its activity id')
      return emptyTwimlResponse(503)
    }
    if (priorState === 'processing') {
      const leaseStartedAt = typeof priorMetadata?.inbound_processing_started_at === 'string'
        ? Date.parse(priorMetadata.inbound_processing_started_at)
        : Number.NaN
      if (Number.isFinite(leaseStartedAt) && Date.now() - leaseStartedAt < 60_000) {
        return emptyTwimlResponse(503)
      }
    }
    let inboundMetadata: Record<string, unknown> | null = priorMetadata

    try {
      const consentTwiml = await processInboundSmsConsent({ from, to: to || null, keyword: messageBody, messageSid: messageSid || null, source: 'twilio_sms_webhook', allowYesOptIn: true })
      if (consentTwiml) return new NextResponse(consentTwiml, { headers: TWIML_HEADERS })
    } catch (error) {
      console.error('[twilio-sms-webhook] SMS consent persistence failed:', error)
      return emptyTwimlResponse(503)
    }

    // Pin continuity to the first persisted receipt. A later outbound message
    // must not decide where an older, interrupted inbound reply is routed.
    const priorReceivedAt = typeof priorMetadata?.inbound_received_at === 'string'
      ? priorMetadata.inbound_received_at : priorMessage.data?.created_at
    const receivedAt = typeof priorReceivedAt === 'string' && Number.isFinite(Date.parse(priorReceivedAt))
      ? priorReceivedAt : new Date().toISOString()
    const priorNeedsIdentityReview = !priorMessage.data?.lead_id && priorMetadata?.needs_identity_review === true
    // Twilio sends E.164, but older imports can contain formatting and Unicode
    // controls. Explicit ambiguity stays in human review even during recovery.
    const identity = priorMessage.data?.lead_id || priorNeedsIdentityReview ? null
      : await resolveInboundSmsLead(supabase, from, to, receivedAt)
    const lead = priorMessage.data?.lead_id
      ? await findLeadById(priorMessage.data.lead_id)
      : identity?.lead ?? null
    const identityNeedsReview = priorNeedsIdentityReview || identity?.kind === 'ambiguous' || identity?.kind === 'unsupported'
    const leadId = lead?.id || null
    const leadName = lead?.full_name || 'Unknown'
    const suppressionReason = await smsSuppressionReason(from)
    const isTeamMessage = TEAM_NUMBERS.has(from)

    // Prospect lookup for unknown senders
    let prospectMatch: ProspectMatch | null = null
    if (!lead && !identityNeedsReview && !isHardBlockedReason(suppressionReason)) {
      const matches = await lookupProspectByPhone(from)
      prospectMatch = matches.length > 0 ? matches[0] : null
    }

    const identityMetadata: Record<string, unknown> = identity ? {
      inbound_lead_resolution: identity.kind,
      inbound_lead_candidate_count: identity.candidateCount,
      ...(identity.matchedOutboundActivityId ? { inbound_matched_outbound_activity_id: identity.matchedOutboundActivityId } : {}),
      ...(identityNeedsReview ? { needs_identity_review: true } : {}),
      ...(identity.kind === 'unsupported' ? { inbound_identity_review_reason: 'unsupported_phone_identity' } : {}),
    } : {}

    // Log the inbound SMS to lead_activities
    const primaryMetadata: Record<string, unknown> = {
      ...(prospectMatch ? {
        source: 'tax_delinquent_inbound_sms',
        prospect_id: prospectMatch.prospect_id,
        heir_name: prospectMatch.contact_name,
        heir_relation: prospectMatch.relationship,
        prospect_owner_name: prospectMatch.owner_1,
      } : { source: 'twilio_sms_webhook' }),
      direction: 'received',
      from,
      to,
      message_sid: messageSid,
      inbound_webhook_source: 'twilio_sms_webhook',
      inbound_webhook_version: '2',
      inbound_processing_state: 'pending',
      inbound_received_at: receivedAt,
      lead_name: leadName,
      ...identityMetadata,
      ...(isTeamMessage ? { is_team: true } : {}),
    }
    const claimId = crypto.randomUUID()
    let primaryActivityId = priorMessage.data?.id as string | undefined
    let primaryActivityLeadId = (priorMessage.data?.lead_id as string | null | undefined) ?? null
    const completeInboundProcessing = async () => {
      const completedMetadata = { ...(inboundMetadata ?? primaryMetadata), inbound_processing_state: 'completed' }
      const { data, error } = await supabase.from('lead_activities').update({ metadata: completedMetadata })
        .eq('id', primaryActivityId)
        .eq('activity_type', 'sms')
        .eq('metadata->>message_sid', messageSid)
        .eq('metadata->>inbound_processing_claim_id', claimId)
        .select('id')
        .maybeSingle()
      if (error || !data) throw error ?? new Error('Inbound SMS processing claim was lost before completion')
      inboundMetadata = completedMetadata
    }

    if (priorMessage.data) {
      // Keep the persisted receipt and lease evidence, while recording an
      // identity first resolved during recovery before claiming this attempt.
      // If completion fails, these markers pin the next retry to review.
      inboundMetadata = { ...priorMetadata, inbound_received_at: receivedAt, ...identityMetadata }
    } else {
      const { data: insertedActivity, error: activityInsertError } = await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'sms',
        description: messageBody,
        agent: 'system',
        created_at: receivedAt,
        metadata: primaryMetadata,
      }).select('id,lead_id').single()
      inboundMetadata = primaryMetadata
      primaryActivityId = insertedActivity?.id
      primaryActivityLeadId = insertedActivity?.lead_id ?? null
      if (activityInsertError) {
      // The partial unique index is the concurrent-delivery arbiter. A retry
      // that lost that race has already been recorded by the winning request.
      if (activityInsertError.code === '23505'
        && `${activityInsertError.message} ${activityInsertError.details || ''}`.includes('lead_activities_twilio_inbound_message_sid_v2')) {
        // The winning delivery has only claimed persistence so far. Ask Twilio
        // to retry and let the next preflight distinguish pending/completed.
        return emptyTwimlResponse(503)
      }
      console.error('[twilio-sms-webhook] inbound activity persistence failed:', activityInsertError)
      return emptyTwimlResponse(503)
    }
    }
    if (!primaryActivityId) {
      console.error('[twilio-sms-webhook] inbound activity insert returned no id')
      return emptyTwimlResponse(503)
    }

    // Persist a per-SID lease before side effects. Concurrent Twilio retries
    // cannot process together; a failed/stalled claim becomes retryable after
    // one minute. The database update compares the prior state atomically.
    const claimedMetadata = {
      ...(inboundMetadata ?? primaryMetadata),
      inbound_processing_state: 'processing',
      inbound_processing_started_at: new Date().toISOString(),
      inbound_processing_claim_id: claimId,
    }
    let claim = supabase.from('lead_activities').update({ metadata: claimedMetadata })
      .eq('id', primaryActivityId)
      .eq('activity_type', 'sms')
      .eq('metadata->>message_sid', messageSid)
      .eq('metadata->>inbound_processing_state', priorMessage.data ? priorState : 'pending')
    if (priorState === 'processing') {
      claim = claim.eq('metadata->>inbound_processing_claim_id', priorMetadata?.inbound_processing_claim_id ?? '')
    }
    const { data: claimedRow, error: claimError } = await claim.select('id').maybeSingle()
    if (claimError || !claimedRow) {
      if (claimError) console.error('[twilio-sms-webhook] inbound processing claim failed:', claimError)
      return emptyTwimlResponse(503)
    }
    inboundMetadata = claimedMetadata
    if (!primaryActivityId) return emptyTwimlResponse(503)

    // A prior attempt may have created the lead and stopped before linking its
    // original activity. Repair that link for every resumed known-lead path.
    if (leadId && primaryActivityId && primaryActivityLeadId !== leadId) {
      await linkInboundActivity(primaryActivityId, leadId, claimId)
      primaryActivityLeadId = leadId
    }

    if (isHardBlockedReason(suppressionReason)) {
      await completeInboundProcessing()
      return emptyTwimlResponse()
    }

    // Retain uncertain identities in the unmatched inbox for human review.
    // Duplicate or unsupported phones cannot authorize lead creation,
    // appointment/YES automation, or outgoing messages on a candidate's behalf.
    if (identityNeedsReview) {
      await completeInboundProcessing()
      return emptyTwimlResponse()
    }

    // ── Team numbers: log + notify, but skip auto-reply/lead creation ──
    if (isTeamMessage) {
      // Still notify — team messages shouldn't be silently swallowed
      const teamMember = from === CASEY_PHONE ? 'Casey' :
                         from === ERNEST_PHONE ? 'Ernest' :
                         from === '+18166088588' ? 'Ernest (co)' :
                         from === '+18167277667' ? 'Casey (co)' : 'Team'
      const teamAlert = `📩 ${teamMember} texted ${formatPhone(to)}: "${messageBody.slice(0, 100)}"`

      // Push notification to CRM
      sendInboundSmsPush(to, {
        title: `Team SMS: ${teamMember}`,
        body: messageBody.slice(0, 80),
        url: '/conversations',
        tag: 'team-sms',
      }, { messageSid })

      // Log to activities so it shows in Conversations
      try {
        await supabase.from('lead_activities').insert({
          lead_id: null,
          activity_type: 'sms',
          description: teamAlert,
          agent: 'system',
          metadata: {
            direction: 'received',
            from,
            to,
            message_sid: messageSid,
            team_member: teamMember,
            is_team: true,
          },
        })
      } catch {}

      await completeInboundProcessing()
      return emptyTwimlResponse()
    }

    if (isGoogleAdsSms) {
      let googleAdsLeadId = leadId
      let googleAdsLeadName = leadName

      if (googleAdsLeadId) {
        await markLeadAsGoogleAdsPhoneLead(googleAdsLeadId, from, leadName, to)
      } else {
        const googleAdsLead = await resolveGoogleAdsLeadContext(from, to)
        googleAdsLeadId = googleAdsLead.leadId
        googleAdsLeadName = googleAdsLead.leadName || googleAdsLeadName
      }

      if (!googleAdsLeadId) throw new Error('Google Ads inbound SMS lead resolution returned no id')

      if (googleAdsLeadId) {
        if (!primaryActivityId) throw new Error('Google Ads SMS has no persisted inbound activity')
        await linkInboundActivity(primaryActivityId, googleAdsLeadId, claimId)
        primaryActivityLeadId = googleAdsLeadId
      }

      await notifyGoogleAdsTeam(
        googleAdsNewTextTeamMessage(from, messageBody, googleAdsLeadId, to),
        {
          leadId: googleAdsLeadId,
          trigger: 'google_ads_inbound_sms',
          calledNumber: to,
          metadata: {
            direction: 'outbound_alert',
            from,
            to,
            message_sid: messageSid,
            lead_name: googleAdsLeadName,
          },
        },
      )

      await completeInboundProcessing()
      return emptyTwimlResponse()
    }

    // ── Keyword detection and internal escalation ───────────
    const msg = messageBody.trim().toUpperCase()

    // Appointment replies are grounded in the canonical appointment row. A
    // free-form reply remains a normal conversation; it does not create a
    // heuristic risk score or an automation task.
    if (leadId) {
      try {
        const appointmentResponse = await recordAppointmentSmsResponse({
          leadId,
          message: messageBody,
          messageSid: messageSid || null,
        })
        if (appointmentResponse.handled) {
          regenerateBriefing(
            leadId,
            appointmentResponse.response === 'confirm' ? 'appointment_confirmed' : appointmentResponse.response === 'reschedule' ? 'appointment_rescheduled' : 'appointment_reply_review',
          ).catch(() => {})
          await completeInboundProcessing()
          return emptyTwimlResponse()
        }
      } catch (error) {
        console.error('[twilio-sms-webhook] canonical appointment response failed:', error)
        // Keep the inbound conversation actionable rather than acknowledging a
        // state change that was not persisted.
      }
    }

    // ── YES reply to an automated Reply YES prompt (missed-call text-back,
    // IVR text, or company-line auto-text). A YES to a human 1:1, or a YES
    // we cannot tie to one of those prompts, stays on the normal reply alert.
    const yesKeyword = msg === 'YES' || msg === 'YES!' || msg === 'YES PLEASE' || msg === 'Y'
    const matchedOutboundActivityId = typeof inboundMetadata?.inbound_matched_outbound_activity_id === 'string'
      ? inboundMetadata.inbound_matched_outbound_activity_id
      : null
    if (yesKeyword && await inboundAnswersAutomatedYesPrompt(supabase as unknown as ReplyYesPromptDb, {
      matchedOutboundActivityId,
      leadId,
      customerPhone: from,
    })) {
      let yesLeadId = leadId

      // Create lead if unknown caller
      if (!yesLeadId) {
        if (prospectMatch) {
          // Tax delinquent prospect — create enriched lead
          yesLeadId = await createEnrichedLeadFromProspect(prospectMatch, from, 'tax_delinquent_inbound_sms', 'hot') || undefined
          if (!yesLeadId) throw new Error('YES reply prospect lead creation failed')
        } else {
          const { data: newLead, error: leadCreateError } = await supabase.from('leads').insert({
            full_name: 'Inbound Seller (YES reply)',
            phone: from,
            source: 'sms_yes_reply',
            station: 'new',
            priority: 'hot',
          }).select('id').single()
          if (leadCreateError || !newLead?.id) throw new Error(leadCreateError?.message || 'YES reply lead creation returned no id')
          yesLeadId = newLead?.id
        }
        if (!primaryActivityId) throw new Error('YES reply has no persisted inbound activity')
        await linkInboundActivity(primaryActivityId, yesLeadId, claimId)
        primaryActivityLeadId = yesLeadId
      } else {
        const { error: priorityError } = await supabase.from('leads')
          .update({ priority: 'hot' })
          .eq('id', yesLeadId)
        if (priorityError) throw priorityError
      }

      // Alert only the agents eligible for the receiving company number and current schedule.
      const prospectCtx = prospectMatch ? `\n🏠 ${formatProspectAlert(prospectMatch)}` : ''
      const yesAlertBody = prospectMatch
        ? `🔥 TAX PROSPECT replied YES! ${prospectMatch.owner_1 || from}${prospectCtx}${yesLeadId ? '\n' + BASE_URL + '/leads/' + yesLeadId : ''}`
        : `🔥 HOT: ${leadName !== 'Unknown' ? leadName : from} replied YES to sell. Call NOW.${yesLeadId ? ' ' + BASE_URL + '/leads/' + yesLeadId : ''}`
      await sendAlertSms(yesAlertBody)

      // Push notification
      sendInboundSmsPush(to, {
        title: 'HOT: YES Reply',
        body: `${leadName !== 'Unknown' ? leadName : from} replied YES to sell. Call NOW.`,
        url: yesLeadId ? `/leads/${yesLeadId}` : '/',
        tag: 'yes-reply',
      }, { leadId: yesLeadId, messageSid })

      // Log the alert SMS
      if (yesLeadId) {
        await supabase.from('lead_activities').insert({
          lead_id: yesLeadId,
          activity_type: 'sms',
          description: yesAlertBody,
          agent: 'System',
          metadata: { direction: 'outbound_alert', to_agents: alertRecipients.map((recipient) => recipient.name), trigger: 'yes_reply_alert' },
        })
      }

      // Conversations owns reply actionability; the briefing remains supporting context.
      if (yesLeadId) {
        await supabase.from('ari_briefing_events').insert({
          event_type: 'yes_reply_seller',
          priority: 'critical',
          title: `🔥 ${leadName !== 'Unknown' ? leadName : from} replied YES — wants to sell`,
          description: `Replied YES to auto-text. Casey notified. Phone: ${formatPhone(from)}`,
          lead_id: yesLeadId,
          action_url: `/leads/${yesLeadId}`,
        })

        // Eager briefing regen — YES reply is the highest-value signal
        regenerateBriefing(yesLeadId, 'yes_reply').catch(() => {})
      }

      await completeInboundProcessing()
      return emptyTwimlResponse()
    }

    // ── STOP / DNC handling (secondary logging — TCPA opt-out already handled above) ──
    if (msg === 'STOP' || msg === 'UNSUBSCRIBE' || msg === 'CANCEL') {
      // Twilio handles STOP automatically at carrier level
      // But log it so we know
      if (leadId) {
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'status_change',
          description: `Opt-out received: "${messageBody.trim()}"`,
          agent: 'System',
          metadata: { trigger: 'sms_opt_out', from },
        })
      }
      // Don't reply — Twilio sends its own STOP confirmation
      await completeInboundProcessing()
      return emptyTwimlResponse()
    }

    // ── Known lead replies ──
    if (lead) {
      const alertBody = `📩 ${leadName} just texted: "${messageBody.slice(0, 100)}" — ${BASE_URL}/leads/${leadId}`

      const alertResults = await Promise.all(alertRecipients.map(async (recipient) => ({
        recipient,
        result: await safeSendSMS({ body: alertBody, from: TWILIO_PHONE, to: recipient.phone }),
      })))

      // Push notification as backup
      sendInboundSmsPush(to, {
        title: 'Lead Texted',
        body: `${leadName}: "${messageBody.slice(0, 80)}"`,
        url: `/leads/${leadId}`,
        tag: 'lead-sms',
      }, { leadId, messageSid })

      // Log the alert intent and delivery status
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'sms',
        description: alertBody,
        agent: 'System',
        metadata: {
          direction: 'outbound_alert',
          to_agents: alertRecipients.map((recipient) => recipient.name),
          trigger: 'lead_reply_alert',
          delivery_status: alertResults.map(({ recipient, result }) => ({
            agent: recipient.name,
            success: result.success,
            sid: result.sid,
            error: result.error,
          })),
        },
      })
    }

    // ── Unknown number — create/enrich lead, alert agents, create task. No generic seller auto-reply. ──
    if (!lead) {
      let newLeadId: string | null = null

      if (prospectMatch) {
        // Tax delinquent prospect — create enriched lead
        newLeadId = await createEnrichedLeadFromProspect(prospectMatch, from, 'tax_delinquent_inbound_sms', 'warm')
        if (!newLeadId) throw new Error('Inbound prospect lead creation failed')
      } else {
        // Generic unknown SMS — create basic lead
        const { data: newLead, error: leadCreateError } = await supabase.from('leads').insert({
          full_name: `SMS Lead ${formatPhone(from) || from}`,
          phone: from,
          source: 'inbound_sms',
          station: 'new',
          priority: 'warm',
        }).select('id').single()
        if (leadCreateError || !newLead?.id) throw new Error(leadCreateError?.message || 'Inbound lead creation returned no id')
        newLeadId = newLead?.id || null

      }

      if (newLeadId) {
        // Link the original inbound activity before sending alerts or completing
        // the lease; retry after any error can find the created lead by phone.
        if (!primaryActivityId) throw new Error('Inbound SMS has no persisted activity to link')
        await linkInboundActivity(primaryActivityId, newLeadId, claimId)
        primaryActivityLeadId = newLeadId

        // Alert only eligible recipients for the receiving company number.
        const unknownProspectCtx = prospectMatch ? `\n🏠 ${formatProspectAlert(prospectMatch)}` : ''
        const smsAlert = prospectMatch
          ? `🔥 TAX PROSPECT texted! ${prospectMatch.owner_1 || formatPhone(from)}: "${messageBody.slice(0, 60)}"${unknownProspectCtx}\n${BASE_URL}/leads/${newLeadId}`
          : `📩 New text from unknown number ${formatPhone(from)}: "${messageBody.slice(0, 80)}" ${BASE_URL}/leads/${newLeadId}`
        await sendAlertSms(smsAlert)

        // Log the alert
        await supabase.from('lead_activities').insert({
          lead_id: newLeadId,
          activity_type: 'sms',
          description: smsAlert,
          agent: 'System',
          metadata: { direction: 'outbound_alert', to_agents: alertRecipients.map((recipient) => recipient.name), trigger: prospectMatch ? 'prospect_sms_alert' : 'unknown_sms_alert' },
        })

        // Push notification
        sendInboundSmsPush(to, {
          title: prospectMatch ? 'Tax Prospect Texted!' : 'Unknown SMS',
          body: prospectMatch
            ? `${prospectMatch.owner_1 || from}: "${messageBody.slice(0, 60)}"`
            : `${formatPhone(from)}: "${messageBody.slice(0, 60)}"`,
          url: `/leads/${newLeadId}`,
          tag: prospectMatch ? 'prospect-sms' : 'unknown-sms',
        }, { leadId: newLeadId, messageSid })

        // Ari briefing event — include prospect metadata
        try {
          await supabase.from('ari_briefing_events').insert({
            event_type: prospectMatch ? 'prospect_inbound_sms' : 'unknown_sms',
            priority: prospectMatch ? 'critical' : 'medium',
            title: prospectMatch
              ? `Tax prospect texted: ${prospectMatch.owner_1 || formatPhone(from)}`
              : `New text from unknown: ${formatPhone(from)}`,
            description: prospectMatch
              ? `Message: "${messageBody.slice(0, 120)}". ${formatProspectAlert(prospectMatch)}`
              : `Message: "${messageBody.slice(0, 120)}". Lead created, agents notified.`,
            lead_id: newLeadId,
            action_url: `/leads/${newLeadId}`,
            metadata: prospectMatch ? {
              parcel_id: prospectMatch.parcel_id,
              county: prospectMatch.county,
              cumulative_due: prospectMatch.cumulative_due,
              is_deceased: prospectMatch.is_deceased,
              property_address: prospectMatch.situs_street || prospectMatch.situs_address,
            } : undefined,
          })
        } catch {}
      }

      // Generic unknown/prospect texts are human takeover only.
    }

    // No auto-reply for general messages from known leads — keep it human
    await completeInboundProcessing()
    return emptyTwimlResponse()

  } catch (err) {
    console.error('Twilio SMS webhook error:', err)
    return emptyTwimlResponse(503)
  }
}
