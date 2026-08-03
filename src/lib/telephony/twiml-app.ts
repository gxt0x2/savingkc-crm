const TWIML_APP_FRIENDLY_NAME = 'SavingKC CRM'
const CANONICAL_VOICE_URL = 'https://crm.savingkc.com/api/twiml-voice'

function env(name: string): string {
  return process.env[name]?.replace(/\\n/g, '').trim() ?? ''
}

export function cleanTwilioEnv(name: string): string {
  return env(name)
    .replace(/\\[rnt]/g, '')
    .replace(/\s+/g, '')
}

export function requireTwilioEnv(name: string, expectedPrefix?: string): string {
  const value = cleanTwilioEnv(name)
  if (!value) throw new Error(`${name} is not configured`)
  if (expectedPrefix && !value.startsWith(expectedPrefix)) throw new Error(`${name} is malformed`)
  return value
}

function isProductionRuntime(): boolean {
  const appUrl = env('NEXT_PUBLIC_APP_URL').replace(/\/$/, '')
  return env('VERCEL_ENV') === 'production' || appUrl === 'https://crm.savingkc.com'
}

export async function resolveTwimlAppSid(): Promise<string | undefined> {
  const configuredSid = cleanTwilioEnv('TWILIO_TWIML_APP_SID')
  if (configuredSid) return configuredSid

  const accountSid = requireTwilioEnv('TWILIO_ACCOUNT_SID', 'AC')
  const apiKey = requireTwilioEnv('TWILIO_API_KEY', 'SK')
  const apiSecret = requireTwilioEnv('TWILIO_API_SECRET')
  const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')

  try {
    const listResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications.json`,
      { headers: { Authorization: `Basic ${credentials}` } },
    )
    const listData = await listResponse.json() as { applications?: Array<{ friendly_name: string; sid: string }> }
    const existing = listData.applications?.find((application) => application.friendly_name === TWIML_APP_FRIENDLY_NAME)
    if (existing) return existing.sid

    // Preview and mobile token reads must never create or rewrite shared voice
    // infrastructure. Canonical application creation is production-only.
    if (!isProductionRuntime()) return undefined

    const createResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          FriendlyName: TWIML_APP_FRIENDLY_NAME,
          VoiceUrl: CANONICAL_VOICE_URL,
          VoiceMethod: 'POST',
        }).toString(),
      },
    )
    const created = await createResponse.json() as { sid?: string }
    return created.sid
  } catch {
    return undefined
  }
}
