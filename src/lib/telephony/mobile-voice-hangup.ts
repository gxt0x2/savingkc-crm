import twilio from 'twilio'
import { cleanTwilioEnv } from '@/lib/telephony/twiml-app'

const CALL_SID = /^CA[0-9a-f]{32}$/i
const TERMINAL = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled'])
const ACTIVE_WINDOW_MS = 5 * 60_000
const MOBILE_SOURCES = new Set(['mobile_manual', 'mobile_lead'])
const SWEEP_ATTEMPTS = 4
const SWEEP_WAIT_MS = 350

type ProviderCall = {
  sid?: string
  from?: string
  to?: string
  status?: string
  parentCallSid?: string | null
  statusCallback?: string | null
  status_callback?: string | null
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

function statusCallbackUrl(call: ProviderCall): string | null {
  const value = call.statusCallback ?? call.status_callback ?? ''
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

/** The voice webhook stamps the mobile attempt on the PSTN child's status callback. */
export function mobileAttemptMarker(url: string | null | undefined): { clientAttemptId: string; source: string } | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const clientAttemptId = parsed.searchParams.get('clientAttemptId')?.trim() ?? ''
  const source = parsed.searchParams.get('source')?.trim() ?? ''
  if (!clientAttemptId || !MOBILE_SOURCES.has(source)) return null
  return { clientAttemptId, source }
}

export function parentMatchesMobileAttempt(
  parent: ProviderCall,
  children: ProviderCall[],
  clientAttemptId: string,
): boolean {
  return [parent, ...children].some((leg) => (
    mobileAttemptMarker(statusCallbackUrl(leg))?.clientAttemptId === clientAttemptId
  ))
}

async function childLegs(calls: CallResource, parentSid: string): Promise<ProviderCall[]> {
  if (typeof calls.list !== 'function') return []
  const children = await calls.list({ parentCallSid: parentSid, limit: 10 })
  const detailed: ProviderCall[] = []
  for (const child of children) {
    if (statusCallbackUrl(child)) {
      detailed.push(child)
      continue
    }
    const sid = child.sid?.trim() ?? ''
    if (!CALL_SID.test(sid)) {
      detailed.push(child)
      continue
    }
    detailed.push(await calls(sid).fetch())
  }
  return detailed
}

/**
 * End the one outbound client leg this phone started.
 * The web prospecting dialer uses the same client identity, so a leg is ended
 * only when its status callback carries this clientAttemptId and a mobile source.
 * A miss retries briefly, then reports that the leg was not found. It does not
 * widen to other live calls.
 */
export async function hangupActiveClientOutboundCalls(
  identity: string,
  clientAttemptId: string,
  options: { attempts?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<'disconnected' | 'already_ended'> {
  const attemptId = clientAttemptId.trim()
  if (!identity) throw new MobileHangupError('CRM calling identity unavailable', 403)
  if (!attemptId || attemptId.length > 200) {
    throw new MobileHangupError('A mobile call attempt is required', 400)
  }
  const client = voiceClient()
  if (typeof client.calls.list !== 'function') {
    throw new MobileHangupError('Could not confirm that the call ended. Retry End.', 503)
  }
  const expected = `client:${identity}`
  const attempts = Math.max(1, options.attempts ?? SWEEP_ATTEMPTS)
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const recent = await client.calls.list({
        from: expected,
        startTimeAfter: new Date(Date.now() - ACTIVE_WINDOW_MS),
        limit: 20,
      })
      const parents = recent.filter((call) => call.from === expected)
      for (const parent of parents) {
        const parentSid = parent.sid?.trim() ?? ''
        if (!CALL_SID.test(parentSid)) continue
        const children = await childLegs(client.calls, parentSid)
        if (!parentMatchesMobileAttempt(parent, children, attemptId)) continue
        const legs = [parent, ...children]
        if (legs.every((leg) => TERMINAL.has(leg.status ?? ''))) return 'already_ended'
        let ended = false
        if (await endProviderCall(client.calls, parent)) ended = true
        for (const child of children) {
          if (child.sid?.trim() === parentSid) continue
          if (await endProviderCall(client.calls, child)) ended = true
        }
        return ended ? 'disconnected' : 'already_ended'
      }
      if (attempt < attempts - 1) await wait(SWEEP_WAIT_MS)
    }
    throw new MobileHangupError(
      'That mobile call is not on Twilio yet. Retry End. Other calls were left connected.',
      404,
    )
  } catch (error) {
    if (error instanceof MobileHangupError) throw error
    const provider = error as { code?: number; status?: number }
    if (provider?.code === 20404 || provider?.status === 404) {
      throw new MobileHangupError('Call not found for this user', 404)
    }
    throw new MobileHangupError('Could not confirm that the call ended. Retry End.', 503)
  }
}
