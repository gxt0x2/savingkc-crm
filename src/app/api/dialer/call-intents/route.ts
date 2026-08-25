import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  dialerBlockStatus,
  evaluateOutboundDialerCall,
  isAllowedDialerCallerId,
  recordBlockedDialerCall,
} from '@/lib/server/dialer-call-eligibility'
import {
  createDialerCallIntent,
  type DialerCallIntentKind,
  type DialerCallIntentSource,
} from '@/lib/telephony/dialer-call-intent'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import {
  authorizeDialerSessionAttempt,
  DialerSessionError,
  getDialerSession,
  isUuid,
} from '@/lib/server/dialer-session-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Cookie',
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

function sourceForKind(kind: DialerCallIntentKind): DialerCallIntentSource {
  if (kind === 'heir' || kind === 'prospect') return 'web_heir_dialer'
  if (kind === 'lead') return 'web_power_dialer'
  return 'web_manual'
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return json({ allowed: false, error: 'Unauthorized' }, 401)

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return json({ allowed: false, error: 'Invalid request body' }, 400)
  }

  const phone = text(body.phone)
  const leadId = text(body.leadId)
  const prospectId = text(body.prospectId)
  const prospectPhoneId = text(body.prospectPhoneId)
  const campaignMemberId = text(body.campaignMemberId)
  const clientAttemptId = text(body.clientAttemptId)
  const sessionId = text(body.sessionId)
  const kind = text(body.kind) as DialerCallIntentKind | null
  if (!phone || !kind || !['manual', 'lead', 'heir', 'prospect'].includes(kind)) {
    return json({ allowed: false, error: 'Phone and a valid call kind are required' }, 400)
  }
  if (
    (kind === 'manual' && (leadId || prospectId || prospectPhoneId || campaignMemberId))
    || (kind === 'lead' && (!leadId || prospectId || prospectPhoneId))
    || (kind === 'heir' && (!leadId || prospectId || !prospectPhoneId))
    || (kind === 'prospect' && (leadId || !prospectId || !prospectPhoneId))
  ) {
    return json({ allowed: false, error: 'Call context does not match the selected contact', reason: 'destination_mismatch' }, 409)
  }
  if (sessionId && (!isUuid(sessionId) || kind === 'manual')) {
    return json({ allowed: false, error: 'Dialer session context is invalid', reason: 'session_context_mismatch' }, 409)
  }

  const profile = resolveAgentTelephonyProfile(actor.email)
  const requestedCallerId = text(body.callerId)
  let session = null
  if (sessionId) {
    try {
      session = await getDialerSession(actor, sessionId)
    } catch (error) {
      if (error instanceof DialerSessionError) {
        return json({ allowed: false, error: error.message, reason: error.code }, error.status)
      }
      console.error('[dialer/call-intents] Session lookup unavailable', error)
      return json({ allowed: false, error: 'Calling is paused because session authorization is unavailable', reason: 'session_engine_unavailable' }, 503)
    }
  }
  const sessionCallerId = session ? text(session.callerId) : null
  if (session && !sessionCallerId) {
    return json({ allowed: false, error: 'The active campaign has no approved caller ID', reason: 'invalid_caller_id' }, 409)
  }
  const callerId = sessionCallerId ?? requestedCallerId ?? profile.defaultCallerId
  if (!isAllowedDialerCallerId(callerId)) {
    return json({ allowed: false, error: 'Select an approved prospecting caller ID', reason: 'invalid_caller_id' }, 409)
  }

  const policyInput = {
    phone,
    leadId,
    prospectId,
    prospectPhoneId,
    source: sourceForKind(kind),
    identity: profile.identity,
    callerId,
    clientAttemptId,
  } as const
  const policy = await evaluateOutboundDialerCall(policyInput)
  if (!policy.allowed) {
    await recordBlockedDialerCall(policyInput, policy)
    return json({ allowed: false, error: policy.message, reason: policy.reason }, dialerBlockStatus(policy.reason))
  }

  try {
    if (session && (
      session.currentSubjectKind !== kind && !(session.currentSubjectKind === 'lead' && kind === 'heir')
      || session.currentSubjectId !== (policy.leadId || policy.prospectId)
      || session.currentCampaignMemberId !== campaignMemberId
    )) {
      return json({ allowed: false, error: 'Call context does not match the active session', reason: 'session_context_mismatch' }, 409)
    }
    const issued = createDialerCallIntent({
      identity: profile.identity,
      to: policy.normalizedPhone,
      callerId,
      kind,
      source: policyInput.source,
      leadId: policy.leadId,
      prospectId: policy.prospectId,
      prospectPhoneId: policy.prospectPhoneId,
      campaignMemberId,
      clientAttemptId,
    })
    if (session) {
      if (!clientAttemptId) {
        return json({ allowed: false, error: 'Dialer session context is incomplete', reason: 'session_context_mismatch' }, 409)
      }
      await authorizeDialerSessionAttempt({
        actor,
        sessionId: session.id,
        clientAttemptId,
        subjectKind: session.currentSubjectKind,
        subjectId: session.currentSubjectId,
        campaignMemberId: session.currentCampaignMemberId,
        leadId: policy.leadId,
        prospectId: policy.prospectId,
        prospectPhoneId: policy.prospectPhoneId,
        phone: issued.claims.to,
        callerId: issued.claims.callerId,
      })
    }
    return json({
      allowed: true,
      intent: issued.token,
      to: issued.claims.to,
      callerId: issued.claims.callerId,
      kind: issued.claims.kind,
      leadId: issued.claims.leadId,
      prospectId: issued.claims.prospectId,
      prospectPhoneId: issued.claims.prospectPhoneId,
      campaignMemberId: issued.claims.campaignMemberId,
      clientAttemptId: issued.claims.clientAttemptId,
      sessionId,
      expiresAt: issued.claims.expiresAt,
    })
  } catch (error) {
    if (error instanceof DialerSessionError) {
      return json({ allowed: false, error: error.message, reason: error.code }, error.status)
    }
    console.error('[dialer/call-intents] Intent signing unavailable', error)
    await recordBlockedDialerCall(policyInput, {
      allowed: false,
      normalizedPhone: policy.normalizedPhone,
      reason: 'policy_unavailable',
      message: 'Calling is paused because authorization is unavailable',
      policyVersion: policy.policyVersion,
      checkedAt: policy.checkedAt,
      leadId: policy.leadId,
      prospectId: policy.prospectId,
      prospectPhoneId: policy.prospectPhoneId,
      reasonSource: 'intent_signing',
    })
    return json({ allowed: false, error: 'Calling is paused because authorization is unavailable', reason: 'policy_unavailable' }, 503)
  }
}
