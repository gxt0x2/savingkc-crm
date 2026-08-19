const TWIML_APP_FRIENDLY_NAME = 'SavingKC CRM'
const DEFAULT_APP_URL = 'https://crm.savingkc.com'
const TWIML_VOICE_PATH = '/api/twiml-voice'

type TwilioApplication = {
  friendly_name?: unknown
  sid?: unknown
  voice_url?: unknown
  voice_method?: unknown
}

type TwilioApplicationList = {
  applications?: unknown
}

type TwimlAppFetch = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

export type TwimlAppResolverOptions = {
  fetchImpl?: TwimlAppFetch
}

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
  const vercelEnvironment = env('VERCEL_ENV')
  if (vercelEnvironment) return vercelEnvironment === 'production'
  return appUrl === DEFAULT_APP_URL
}

function expectedTwimlVoiceUrl(): string | null {
  const configuredAppUrl = env('NEXT_PUBLIC_APP_URL') || DEFAULT_APP_URL
  try {
    const appUrl = new URL(configuredAppUrl)
    if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password) return null
    return new URL(TWIML_VOICE_PATH, `${appUrl.origin}/`).toString()
  } catch {
    return null
  }
}

function isApplicationSid(value: unknown): value is string {
  return typeof value === 'string' && /^AP[0-9a-fA-F]{32}$/.test(value)
}

function asApplication(value: unknown): TwilioApplication | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as TwilioApplication
    : null
}

function isCanonicalApplication(
  application: TwilioApplication | null,
  expectedVoiceUrl: string,
  expectedSid?: string,
): application is TwilioApplication & { sid: string } {
  return Boolean(
    application
    && isApplicationSid(application.sid)
    && (!expectedSid || application.sid === expectedSid)
    && application.voice_url === expectedVoiceUrl
    && application.voice_method === 'POST',
  )
}

async function requestJson(
  fetchImpl: TwimlAppFetch,
  input: string,
  init: RequestInit,
): Promise<unknown | null> {
  const response = await fetchImpl(input, init)
  if (!response.ok) return null
  return response.json().catch(() => null)
}

function twilioHeaders(credentials: string, contentType = false): HeadersInit {
  return {
    Authorization: `Basic ${credentials}`,
    ...(contentType ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
  }
}

/**
 * Resolve only a live TwiML Application whose outbound Voice webhook is the
 * canonical CRM route using POST. A configured SID is a lookup key, not proof
 * of integrity; every successful resolution is backed by Twilio's live
 * Application resource before a caller can receive a Voice grant.
 */
export async function resolveTwimlAppSid(
  options: TwimlAppResolverOptions = {},
): Promise<string | undefined> {
  const expectedVoiceUrl = expectedTwimlVoiceUrl()
  if (!expectedVoiceUrl) return undefined

  const configuredSid = cleanTwilioEnv('TWILIO_TWIML_APP_SID')
  if (configuredSid && !isApplicationSid(configuredSid)) return undefined

  const accountSid = requireTwilioEnv('TWILIO_ACCOUNT_SID', 'AC')
  const apiKey = requireTwilioEnv('TWILIO_API_KEY', 'SK')
  const apiSecret = requireTwilioEnv('TWILIO_API_SECRET')
  const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
  const fetchImpl = options.fetchImpl ?? fetch
  const applicationsUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Applications`

  async function fetchApplication(sid: string): Promise<TwilioApplication | null> {
    const payload = await requestJson(fetchImpl, `${applicationsUrl}/${sid}.json`, {
      cache: 'no-store',
      headers: twilioHeaders(credentials),
    })
    return asApplication(payload)
  }

  try {
    if (configuredSid) {
      const configured = await fetchApplication(configuredSid)
      return isCanonicalApplication(configured, expectedVoiceUrl, configuredSid)
        ? configured.sid
        : undefined
    }

    const listPayload = await requestJson(fetchImpl, `${applicationsUrl}.json?PageSize=1000`, {
      cache: 'no-store',
      headers: twilioHeaders(credentials),
    }) as TwilioApplicationList | null
    // An unavailable or malformed list must not be mistaken for an empty
    // account, which could otherwise create a duplicate application.
    if (!Array.isArray(listPayload?.applications)) return undefined
    const applications = listPayload.applications
      .map(asApplication)
      .filter((item): item is TwilioApplication => Boolean(item))
    const candidates = applications.filter((application) => application.friendly_name === TWIML_APP_FRIENDLY_NAME)

    for (const candidate of candidates) {
      if (!isApplicationSid(candidate.sid)) continue
      const liveApplication = await fetchApplication(candidate.sid)
      if (isCanonicalApplication(liveApplication, expectedVoiceUrl, candidate.sid)) return liveApplication.sid
    }

    // A named application with the wrong Voice route is an integrity failure,
    // not permission to create a second ambiguous application.
    if (candidates.length > 0 || !isProductionRuntime()) return undefined

    const createPayload = await requestJson(fetchImpl, `${applicationsUrl}.json`, {
      method: 'POST',
      cache: 'no-store',
      headers: twilioHeaders(credentials, true),
      body: new URLSearchParams({
        FriendlyName: TWIML_APP_FRIENDLY_NAME,
        VoiceUrl: expectedVoiceUrl,
        VoiceMethod: 'POST',
      }).toString(),
    })
    const created = asApplication(createPayload)
    if (isCanonicalApplication(created, expectedVoiceUrl)) return created.sid
    if (!isApplicationSid(created?.sid)) return undefined

    const liveApplication = await fetchApplication(created.sid)
    return isCanonicalApplication(liveApplication, expectedVoiceUrl, created.sid)
      ? liveApplication.sid
      : undefined
  } catch {
    return undefined
  }
}
