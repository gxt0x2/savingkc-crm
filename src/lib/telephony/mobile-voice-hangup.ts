import twilio from 'twilio'
import { cleanTwilioEnv } from '@/lib/telephony/twiml-app'

const CALL_SID = /^CA[0-9a-f]{32}$/i
const TERMINAL = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled'])
const ACTIVE_WINDOW_MS = 5 * 60_000

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

/** End this identity's live outbound client legs when the phone has no call SID yet.
 * Inbound calls (to client:identity) are left alone. A PSTN child of a live parent is ended too.
 */
export async function hangupActiveClientOutboundCalls(identity: string): Promise<'disconnected' | 'already_ended'> {
  if (!identity) throw new MobileHangupError('CRM calling identity unavailable', 403)
  const client = voiceClient()
  if (typeof client.calls.list !== 'function') {
    throw new MobileHangupError('Could not confirm that the call ended. Retry End.', 503)
  }
  const expected = `client:${identity}`
  try {
    const recent = await client.calls.list({
      from: expected,
      startTimeAfter: new Date(Date.now() - ACTIVE_WINDOW_MS),
      limit: 20,
    })
    const parents = recent.filter((call) => call.from === expected && !TERMINAL.has(call.status ?? ''))
    if (!parents.length) return 'already_ended'
    let ended = false
    for (const parent of parents) {
      if (await endProviderCall(client.calls, parent)) ended = true
      const parentSid = parent.sid?.trim() ?? ''
      if (!CALL_SID.test(parentSid)) continue
      const children = await client.calls.list({ parentCallSid: parentSid, limit: 10 })
      for (const child of children) {
        if (await endProviderCall(client.calls, child)) ended = true
      }
    }
    return ended ? 'disconnected' : 'already_ended'
  } catch (error) {
    if (error instanceof MobileHangupError) throw error
    // Missing SIDs are not proof that this user's call ended successfully.
    const provider = error as { code?: number; status?: number }
    if (provider?.code === 20404 || provider?.status === 404) {
      throw new MobileHangupError('Call not found for this user', 404)
    }
    throw new MobileHangupError('Could not confirm that the call ended. Retry End.', 503)
  }
}
