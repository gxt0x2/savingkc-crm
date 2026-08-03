export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { PHONE_SYSTEM } from '@/lib/operating-model/phone-system'

function env(name: string) {
  return process.env[name]?.replace(/\\[rnt]/g, '').replace(/\s+/g, '').trim() || ''
}

function configuredClient() {
  const accountSid = env('TWILIO_ACCOUNT_SID')
  const apiKey = env('TWILIO_API_KEY')
  const apiSecret = env('TWILIO_API_SECRET')
  const authToken = env('TWILIO_AUTH_TOKEN')
  if (!accountSid) return null
  if (apiKey && apiSecret) return twilio(apiKey, apiSecret, { accountSid })
  if (authToken) return twilio(accountSid, authToken)
  return null
}

function matchesRoute(value: string | null, suffix: string) {
  if (!value) return false
  try {
    return new URL(value).pathname === suffix
  } catch {
    return value.endsWith(suffix)
  }
}

export async function GET(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  const client = configuredClient()
  if (!client) {
    return NextResponse.json({
      providerAvailable: false,
      generatedAt: new Date().toISOString(),
      numbers: PHONE_SYSTEM.map((record) => ({ number: record.number, carrierStatus: 'not_checked' })),
      extras: [],
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  }

  try {
    const live = await client.incomingPhoneNumbers.list({ limit: 100 })
    const liveByNumber = new Map(live.map((record) => [record.phoneNumber, record]))
    const registered = new Set(PHONE_SYSTEM.map((record) => record.number))
    const numbers = PHONE_SYSTEM.map((record) => {
      const carrier = liveByNumber.get(record.number)
      if (!carrier) return { number: record.number, carrierStatus: 'missing' }
      const voiceMatches = matchesRoute(carrier.voiceUrl, '/api/twiml-voice')
      const smsMatches = matchesRoute(carrier.smsUrl, '/api/twilio-sms-webhook')
      const statusMatches = matchesRoute(carrier.statusCallback, '/api/twilio-missed-call')
      return {
        number: record.number,
        carrierStatus: voiceMatches && smsMatches && statusMatches ? 'verified' : 'mismatch',
        voiceUrl: carrier.voiceUrl,
        smsUrl: carrier.smsUrl,
        statusCallback: carrier.statusCallback,
        voiceFallbackUrl: carrier.voiceFallbackUrl,
        smsFallbackUrl: carrier.smsFallbackUrl,
        capabilities: carrier.capabilities,
        checks: { voiceMatches, smsMatches, statusMatches },
      }
    })

    return NextResponse.json({
      providerAvailable: true,
      generatedAt: new Date().toISOString(),
      numbers,
      extras: live.filter((record) => !registered.has(record.phoneNumber)).map((record) => record.phoneNumber),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    console.error('[phone-system-audit]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Twilio audit failed' }, { status: 502 })
  }
}
