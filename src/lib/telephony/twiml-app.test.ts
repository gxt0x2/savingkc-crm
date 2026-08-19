import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveTwimlAppSid, type TwimlAppResolverOptions } from './twiml-app'

const ACCOUNT_SID = `AC${'a'.repeat(32)}`
const API_KEY = `SK${'b'.repeat(32)}`
const APP_SID = `AP${'c'.repeat(32)}`
const CANONICAL_VOICE_URL = 'https://crm.savingkc.com/api/twiml-voice'

function configureTwilio() {
  vi.stubEnv('TWILIO_ACCOUNT_SID', ACCOUNT_SID)
  vi.stubEnv('TWILIO_API_KEY', API_KEY)
  vi.stubEnv('TWILIO_API_SECRET', 'secret')
}

function response(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

function resolver(fetchImpl: ReturnType<typeof vi.fn>): TwimlAppResolverOptions {
  return { fetchImpl: fetchImpl as NonNullable<TwimlAppResolverOptions['fetchImpl']> }
}

describe('resolveTwimlAppSid', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('fetches and validates a configured application before returning its SID', async () => {
    configureTwilio()
    vi.stubEnv('TWILIO_TWIML_APP_SID', APP_SID)
    const fetchMock = vi.fn().mockResolvedValue(response({
      sid: APP_SID,
      friendly_name: 'SavingKC CRM',
      voice_url: CANONICAL_VOICE_URL,
      voice_method: 'POST',
    }))

    await expect(resolveTwimlAppSid(resolver(fetchMock))).resolves.toBe(APP_SID)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/Applications/${APP_SID}.json`),
      expect.objectContaining({ cache: 'no-store', headers: expect.any(Object) }),
    )
  })

  it.each([
    ['wrong route', 'https://crm.savingkc.com/api/ivr/voice', 'POST'],
    ['wrong method', CANONICAL_VOICE_URL, 'GET'],
  ])('fails closed when the configured application has the %s', async (_label, voiceUrl, voiceMethod) => {
    configureTwilio()
    vi.stubEnv('TWILIO_TWIML_APP_SID', APP_SID)
    const fetchMock = vi.fn().mockResolvedValue(response({
      sid: APP_SID,
      voice_url: voiceUrl,
      voice_method: voiceMethod,
    }))

    await expect(resolveTwimlAppSid(resolver(fetchMock))).resolves.toBeUndefined()
  })

  it('uses the canonical NEXT_PUBLIC_APP_URL origin for the exact Voice route', async () => {
    configureTwilio()
    vi.stubEnv('TWILIO_TWIML_APP_SID', APP_SID)
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://preview.example/some/path/')
    const fetchMock = vi.fn().mockResolvedValue(response({
      sid: APP_SID,
      voice_url: 'https://preview.example/api/twiml-voice',
      voice_method: 'POST',
    }))

    await expect(resolveTwimlAppSid(resolver(fetchMock))).resolves.toBe(APP_SID)
  })

  it('discovers by name but validates the live application resource', async () => {
    configureTwilio()
    vi.stubEnv('TWILIO_TWIML_APP_SID', '')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ applications: [{ friendly_name: 'SavingKC CRM', sid: APP_SID }] }))
      .mockResolvedValueOnce(response({
        sid: APP_SID,
        friendly_name: 'SavingKC CRM',
        voice_url: CANONICAL_VOICE_URL,
        voice_method: 'POST',
      }))

    await expect(resolveTwimlAppSid(resolver(fetchMock))).resolves.toBe(APP_SID)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not create or repair shared Twilio infrastructure from preview', async () => {
    configureTwilio()
    vi.stubEnv('TWILIO_TWIML_APP_SID', '')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://preview.example')
    const fetchMock = vi.fn().mockResolvedValue(response({ applications: [] }))

    await expect(resolveTwimlAppSid(resolver(fetchMock))).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not create from preview even when its public URL points at the canonical host', async () => {
    configureTwilio()
    vi.stubEnv('TWILIO_TWIML_APP_SID', '')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://crm.savingkc.com')
    const fetchMock = vi.fn().mockResolvedValue(response({ applications: [] }))

    await expect(resolveTwimlAppSid(resolver(fetchMock))).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('creates the canonical application in production and validates the returned resource', async () => {
    configureTwilio()
    vi.stubEnv('TWILIO_TWIML_APP_SID', '')
    vi.stubEnv('VERCEL_ENV', 'production')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ applications: [] }))
      .mockResolvedValueOnce(response({
        sid: APP_SID,
        friendly_name: 'SavingKC CRM',
        voice_url: CANONICAL_VOICE_URL,
        voice_method: 'POST',
      }))

    await expect(resolveTwimlAppSid(resolver(fetchMock))).resolves.toBe(APP_SID)
    const createCall = fetchMock.mock.calls[1]
    expect(createCall[1]).toEqual(expect.objectContaining({ method: 'POST' }))
    const body = new URLSearchParams(String(createCall[1]?.body))
    expect(body.get('VoiceUrl')).toBe(CANONICAL_VOICE_URL)
    expect(body.get('VoiceMethod')).toBe('POST')
  })

  it('fails closed when Twilio cannot return the live application', async () => {
    configureTwilio()
    vi.stubEnv('TWILIO_TWIML_APP_SID', APP_SID)
    const fetchMock = vi.fn().mockResolvedValue(response({}, false))

    await expect(resolveTwimlAppSid(resolver(fetchMock))).resolves.toBeUndefined()
  })

  it('does not treat an unavailable production list as permission to create', async () => {
    configureTwilio()
    vi.stubEnv('TWILIO_TWIML_APP_SID', '')
    vi.stubEnv('VERCEL_ENV', 'production')
    const fetchMock = vi.fn().mockResolvedValue(response({}, false))

    await expect(resolveTwimlAppSid(resolver(fetchMock))).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
