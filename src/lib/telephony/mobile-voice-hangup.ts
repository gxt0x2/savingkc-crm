import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { cleanTwilioEnv } from '@/lib/telephony/twiml-app'

const CALL_SID = /^CA[0-9a-f]{32}$/i
const TERMINAL = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled'])
const MOBILE_SOURCES = new Set(['mobile_manual', 'mobile_lead'])
const MAX_ATTEMPT_ID_LENGTH = 200

type ProviderCall = {
  sid?: string
  from?: string
  to?: string
  status?: string
  parentCallSid?: string | null
}

type CallHandle = {
  fetch: () => Promise<ProviderCall>
  update: (body: { status: 'canceled' | 'completed' }) => Promise<unknown>
}

type CallResource = ((sid: string) => CallHandle) & {
  list?: (query: Record<string, unknown>) => Promise<ProviderCall[]>
}

type LedgerDb = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

export class MobileHangupError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function voiceClient(): { calls: CallResource } {
  const accountSid = cleanTwilioEnv('TWILIO_ACCOUNT_SID')
  const apiKey = cleanTwilioEnv('TWILIO_API_KEY')
  const apiSecret = cleanTwilioEnv('TWILIO_API_SECRET')
  const authToken = cleanTwilioEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid) throw new MobileHangupError('Calling is temporarily unavailable', 503)
  if (apiKey && apiSecret) return twilio(apiKey, apiSecret, { accountSid, timeout: 15_000 })
  if (authToken) return twilio(accountSid, authToken, { timeout: 15_000 })
  throw new MobileHangupError('Calling is temporarily unavailable', 503)
}

function endStatus(status: string | undefined): 'canceled' | 'completed' {
  return status === 'queued' || status === 'ringing' ? 'canceled' : 'completed'
}

async function endProviderCall(calls: CallResource, call: ProviderCall): Promise<boolean> {
  const sid = call.sid?.trim() ?? ''
  if (!CALL_SID.test(sid) || TERMINAL.has(call.status ?? '')) return false
  await calls(sid).update({ status: endStatus(call.status) })
  return true
}

/** End only a provider call leg belonging to the authenticated SDK identity.
 * Never accept a seller phone number, caller ID, or client-supplied owner as proof.
 * Repeated requests are naturally idempotent; no new call/message is created.
 */
export async function hangupMobileVoiceCall(callSid: string, identity: string): Promise<'disconnected' | 'already_ended'> {
  const sid = callSid.trim()
  if (!CALL_SID.test(sid)) throw new MobileHangupError('A valid Twilio call SID is required', 400)
  if (!identity) throw new MobileHangupError('CRM calling identity unavailable', 403)
  const client = voiceClient()
  const expected = `client:${identity}`
  try {
    const call = await client.calls(sid).fetch()
    let owned = call.from === expected || call.to === expected
    // A PSTN child leg can be ended only when its provider-owned parent proves identity.
    if (!owned && call.parentCallSid && CALL_SID.test(call.parentCallSid)) {
      const parent = await client.calls(call.parentCallSid).fetch()
      owned = parent.from === expected || parent.to === expected
    }
    if (!owned) throw new MobileHangupError('Call not found for this user', 404)
    if (TERMINAL.has(call.status ?? '')) return 'already_ended'
    await client.calls(sid).update({ status: endStatus(call.status) })
    const children = typeof client.calls.list === 'function'
      ? await client.calls.list({ parentCallSid: sid, limit: 10 })
      : []
    for (const child of children) {
      const childSid = child.sid?.trim() ?? ''
      if (!CALL_SID.test(childSid) || childSid === sid) continue
      await endProviderCall(client.calls, child)
    }
    return 'disconnected'
  } catch (error) {
    if (error instanceof MobileHangupError) throw error
    const provider = error as { code?: number; status?: number }
    if (provider?.code === 20404 || provider?.status === 404) {
      throw new MobileHangupError('Call not found for this user', 404)
    }
    throw new MobileHangupError('Could not confirm that the call ended. Retry End.', 503)
  }
}

export function isMobileVoiceSource(source: string | null | undefined): boolean {
  return MOBILE_SOURCES.has(source?.trim() ?? '')
}

function ledgerState(data: unknown): { parentCallSid: string | null; endRequested: boolean } {
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const parent = typeof row.parent_call_sid === 'string' ? row.parent_call_sid.trim() : ''
  return { parentCallSid: CALL_SID.test(parent) ? parent : null, endRequested: row.end_requested === true }
}

/**
 * End the call one phone attempt started before the phone learned its call SID.
 * Twilio does not return a call's status callback URL, so the attempt is found
 * through mobile_voice_attempts, keyed by SDK identity and attempt id. A web
 * dialer call on the same identity never has a row there, and another agent is
 * another key. When Twilio has not reported a leg yet, the stored request is
 * enforced by the next signed status callback for this attempt.
 */
export async function hangupMobileVoiceAttempt(
  identity: string,
  clientAttemptId: string,
  db?: LedgerDb,
): Promise<'disconnected' | 'already_ended' | 'end_requested'> {
  const attemptId = clientAttemptId.trim()
  if (!identity) throw new MobileHangupError('CRM calling identity unavailable', 403)
  if (!attemptId || attemptId.length > MAX_ATTEMPT_ID_LENGTH) {
    throw new MobileHangupError('A mobile call attempt is required', 400)
  }
  const { data, error } = await (db ?? supabaseAdmin()).rpc('request_mobile_voice_attempt_end_v1', {
    p_identity: identity,
    p_client_attempt_id: attemptId,
  })
  if (error) {
    console.error('[mobile-voice-hangup] End request was not stored:', error)
    throw new MobileHangupError('Could not confirm that the call ended. Retry End.', 503)
  }
  const { parentCallSid } = ledgerState(data)
  if (!parentCallSid) return 'end_requested'
  return hangupMobileVoiceCall(parentCallSid, identity)
}

export type MobileAttemptLegResult = 'recorded' | 'end_enforced' | 'end_failed' | 'unrecorded'

/**
 * Record the Twilio parent call for a mobile attempt from its signed status
 * callback, and end that call when End arrived before Twilio reported it.
 * Never throws: an unavailable ledger must not drop the status callback.
 */
export async function trackMobileVoiceAttemptLeg(
  db: LedgerDb,
  input: {
    identity: string
    clientAttemptId: string
    source: string
    parentCallSid: string
    callSid: string
    callStatus: string
  },
): Promise<MobileAttemptLegResult | null> {
  const identity = input.identity.trim()
  const attemptId = input.clientAttemptId.trim()
  const callSid = input.callSid.trim()
  const parentSid = input.parentCallSid.trim()
  if (
    !isMobileVoiceSource(input.source)
    || !identity
    || !attemptId
    || attemptId.length > MAX_ATTEMPT_ID_LENGTH
    || !CALL_SID.test(callSid)
  ) return null

  let state: ReturnType<typeof ledgerState>
  try {
    const { data, error } = await db.rpc('record_mobile_voice_attempt_leg_v1', {
      p_identity: identity,
      p_client_attempt_id: attemptId,
      p_source: input.source.trim(),
      p_parent_call_sid: CALL_SID.test(parentSid) ? parentSid : null,
      p_call_sid: callSid,
      p_status: input.callStatus.trim() || null,
    })
    if (error) throw error
    state = ledgerState(data)
  } catch (error) {
    console.error('[mobile-voice-hangup] Mobile attempt leg was not recorded:', error)
    return 'unrecorded'
  }

  if (!state.endRequested || !state.parentCallSid || TERMINAL.has(input.callStatus.trim())) return 'recorded'
  try {
    await hangupMobileVoiceCall(state.parentCallSid, identity)
    return 'end_enforced'
  } catch (error) {
    console.error('[mobile-voice-hangup] Stored End could not end the mobile call:', error)
    return 'end_failed'
  }
}
