import { NextRequest, NextResponse } from 'next/server'
import {
  MobileAuthError,
  mobileNoStoreHeaders,
  mobileOptionsResponse,
  requireMobileUser,
} from '@/lib/mobile-api/auth'
import {
  dialerBlockStatus,
  evaluateOutboundDialerCall,
  isAllowedDialerCallerId,
  recordBlockedDialerCall,
} from '@/lib/server/dialer-call-eligibility'
import { createDialerCallIntent } from '@/lib/telephony/dialer-call-intent'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: mobileNoStoreHeaders() })
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireMobileUser(request)
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return json({ allowed: false, error: 'Invalid request body' }, 400)

    const phone = text(body.phone)
    const leadId = text(body.leadId)
    const clientAttemptId = text(body.clientAttemptId)
    const kind = leadId ? 'lead' : 'manual'
    if (!phone) return json({ allowed: false, error: 'Phone is required' }, 400)

    const profile = resolveAgentTelephonyProfile(user.email)
    const requestedCallerId = text(body.callerId)
    const callerId = requestedCallerId ?? profile.defaultCallerId
    if (!isAllowedDialerCallerId(callerId)) {
      return json({ allowed: false, error: 'Select an approved prospecting caller ID', reason: 'invalid_caller_id' }, 409)
    }

    const policyInput = {
      phone,
      leadId,
      prospectPhoneId: null,
      source: leadId ? 'mobile_lead' as const : 'mobile_manual' as const,
      identity: profile.identity,
      callerId,
      clientAttemptId,
    }
    const policy = await evaluateOutboundDialerCall(policyInput)
    if (!policy.allowed) {
      await recordBlockedDialerCall(policyInput, policy)
      return json({ allowed: false, error: policy.message, reason: policy.reason }, dialerBlockStatus(policy.reason))
    }

    try {
      const issued = createDialerCallIntent({
        identity: profile.identity,
        to: policy.normalizedPhone,
        callerId,
        kind,
        source: policyInput.source,
        leadId: policy.leadId,
        clientAttemptId,
      })
      return json({
        allowed: true,
        intent: issued.token,
        to: issued.claims.to,
        callerId: issued.claims.callerId,
        kind: issued.claims.kind,
        leadId: issued.claims.leadId,
        prospectPhoneId: null,
        clientAttemptId: issued.claims.clientAttemptId,
        expiresAt: issued.claims.expiresAt,
      })
    } catch (error) {
      console.error('[mobile/twilio/call-intents] Intent signing unavailable', error)
      await recordBlockedDialerCall(policyInput, {
        allowed: false,
        normalizedPhone: policy.normalizedPhone,
        reason: 'policy_unavailable',
        message: 'Calling is paused because authorization is unavailable',
        policyVersion: policy.policyVersion,
        checkedAt: policy.checkedAt,
        leadId: policy.leadId,
        prospectId: null,
        prospectPhoneId: policy.prospectPhoneId,
        reasonSource: 'intent_signing',
      })
      return json({ allowed: false, error: 'Calling is paused because authorization is unavailable', reason: 'policy_unavailable' }, 503)
    }
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Calling authorization is unavailable'
    return json({ allowed: false, error: message }, status)
  }
}
