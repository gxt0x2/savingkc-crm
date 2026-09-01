import { dialerControllerHeaders } from '@/lib/telephony/dialer-controller-client'
import { DialerSessionClientError, type DialerSessionControlSummary } from '@/lib/dialer-session-client'

export type DialerCallIntentKind = 'manual' | 'lead' | 'heir' | 'prospect'

export type DialerCallIntentAllowedResponse = {
  allowed: true
  intent: string
  to: string
  callerId: string
  kind: DialerCallIntentKind
  leadId: string | null
  prospectId: string | null
  prospectPhoneId: string | null
  campaignMemberId: string | null
  clientAttemptId: string
  sessionId?: string | null
  ringCount?: number | null
}

type DialerCallIntentDeniedResponse = {
  allowed: false
  error?: string
  reason?: string
  details?: DialerSessionControlSummary
}

type DialerCallIntentResponse = DialerCallIntentAllowedResponse | DialerCallIntentDeniedResponse

export function createClientAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function requestDialerCallIntent(input: {
  phone: string
  callerId: string
  kind: DialerCallIntentKind
  leadId: string | null
  prospectId: string | null
  prospectPhoneId: string | null
  campaignMemberId: string | null
  clientAttemptId: string
  sessionId?: string | null
}): Promise<DialerCallIntentAllowedResponse> {
  const response = await fetch('/api/dialer/call-intents', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...await dialerControllerHeaders() },
    body: JSON.stringify(input),
  })
  const payload = await response.json().catch(() => null) as DialerCallIntentResponse | null
  if (!response.ok || !payload?.allowed) {
    const denial = payload?.allowed === false ? payload : null
    if (input.sessionId && denial && ['session_control_lost', 'session_control_conflict', 'session_control_changed'].includes(denial.reason || '')) {
      window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId: input.sessionId } }))
    }
    throw new DialerSessionClientError(
      denial?.error || denial?.reason || 'This call is not allowed. Review the number and try again.',
      denial?.reason,
      denial?.details,
    )
  }
  if (!payload.intent || !payload.to || !payload.callerId || !payload.kind || !payload.clientAttemptId) {
    throw new Error('Call authorization returned an incomplete response. Try again.')
  }
  return {
    allowed: true,
    intent: payload.intent,
    to: payload.to,
    callerId: payload.callerId,
    kind: payload.kind,
    leadId: payload.leadId ?? null,
    prospectId: payload.prospectId ?? null,
    prospectPhoneId: payload.prospectPhoneId ?? null,
    campaignMemberId: payload.campaignMemberId ?? null,
    clientAttemptId: payload.clientAttemptId,
    sessionId: payload.sessionId ?? input.sessionId ?? null,
    ringCount: typeof payload.ringCount === 'number' ? payload.ringCount : null,
  }
}
