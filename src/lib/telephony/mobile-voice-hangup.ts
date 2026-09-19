import twilio from 'twilio'

import { cleanTwilioEnv } from '@/lib/telephony/twiml-app'

const CALL_SID = /^CA[0-9a-f]{32}$/i

export type MobileVoiceHangupResult = 'disconnected' | 'already_ended'

function voiceClient() {
  const accountSid = cleanTwilioEnv('TWILIO_ACCOUNT_SID')
  const apiKey = cleanTwilioEnv('TWILIO_API_KEY')
  const apiSecret = cleanTwilioEnv('TWILIO_API_SECRET')
  const authToken = cleanTwilioEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid) return null
  if (apiKey && apiSecret) return twilio(apiKey, apiSecret, { accountSid, timeout: 15_000 })
  if (authToken) return twilio(accountSid, authToken, { timeout: 15_000 })
  return null
}

export function mobileVoiceHangupConfigured(): boolean {
  return Boolean(voiceClient())
}

function providerField(error: unknown, field: 'code' | 'status'): unknown {
  return typeof error === 'object' && error !== null && field in error
    ? (error as Record<typeof field, unknown>)[field]
    : undefined
}

/**
 * Completes a live Twilio Voice call by SID. Used as the mobile End/hangup
 * fallback when the SDK disconnect does not reach the provider.
 *
 * Independent of TEST_MODE / SMS guards — hangup is containment, not a send.
 * Never touches mojo_call_queue.
 */
export async function hangupMobileVoiceCall(callSid: string): Promise<MobileVoiceHangupResult> {
  const sid = callSid.trim()
  if (!CALL_SID.test(sid)) throw new Error('A valid Twilio call SID is required')
  const client = voiceClient()
  if (!client) throw new Error('Calling is temporarily unavailable')

  try {
    await client.calls(sid).update({ status: 'completed' })
    return 'disconnected'
  } catch (error) {
    const code = providerField(error, 'code')
    const status = providerField(error, 'status')
    if (code === 20404 || status === 404) return 'already_ended'
    throw error
  }
}
