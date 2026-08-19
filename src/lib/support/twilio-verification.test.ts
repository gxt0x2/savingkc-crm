import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyTwilioAccountCredentials } from './twilio-verification'

const ACCOUNT_SID = 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const API_KEY_SID = 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const API_KEY_SECRET = 'synthetic-api-key-secret'
const AUTH_TOKEN = 'synthetic-auth-token'

function configureApiKey() {
  vi.stubEnv('TWILIO_ACCOUNT_SID', ACCOUNT_SID)
  vi.stubEnv('TWILIO_API_KEY', API_KEY_SID)
  vi.stubEnv('TWILIO_API_SECRET', API_KEY_SECRET)
  vi.stubEnv('TWILIO_AUTH_TOKEN', AUTH_TOKEN)
}

describe('Twilio server credential verification', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    vi.stubEnv('TWILIO_API_KEY', '')
    vi.stubEnv('TWILIO_API_SECRET', '')
    vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    vi.stubEnv('TWILIO_SKIP_SIGNATURE_VALIDATION', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('reports boolean presence and does not call Twilio when credentials are incomplete', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('TWILIO_ACCOUNT_SID', ACCOUNT_SID)

    const result = await verifyTwilioAccountCredentials()

    expect(result).toEqual({
      ok: false,
      configuration: {
        accountSidConfigured: true,
        apiKeySidConfigured: false,
        apiKeySecretConfigured: false,
        authTokenConfigured: false,
        credentialMode: 'not_configured',
      },
      signatureValidation: { bypassEnabled: false },
      accountApi: { status: 'not_configured', credentialsValid: null },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_SID)
  })

  it('verifies the auth token with one read-only, no-store Account API request', async () => {
    configureApiKey()
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTwilioAccountCredentials()

    expect(result).toMatchObject({
      ok: true,
      configuration: {
        accountSidConfigured: true,
        apiKeySidConfigured: true,
        apiKeySecretConfigured: true,
        authTokenConfigured: true,
        credentialMode: 'auth_token',
      },
      signatureValidation: { bypassEnabled: false },
      accountApi: { status: 'valid', credentialsValid: true },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}.json`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store' })
    expect(init.body).toBeUndefined()
    expect(init.headers).toEqual({
      Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
    })

    const serialized = JSON.stringify(result)
    for (const sensitiveValue of [ACCOUNT_SID, API_KEY_SID, API_KEY_SECRET, AUTH_TOKEN]) {
      expect(serialized).not.toContain(sensitiveValue)
    }
  })

  it('can verify the auth token when API-key credentials are absent', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', ACCOUNT_SID)
    vi.stubEnv('TWILIO_AUTH_TOKEN', AUTH_TOKEN)
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTwilioAccountCredentials()

    expect(result.configuration.credentialMode).toBe('auth_token')
    expect(result.accountApi).toEqual({ status: 'valid', credentialsValid: true })
    expect(JSON.stringify(result)).not.toContain(AUTH_TOKEN)
  })

  it('does not report ready when API-key credentials exist but the auth token is rejected', async () => {
    configureApiKey()
    vi.stubEnv('TWILIO_SKIP_SIGNATURE_VALIDATION', 'true')
    const providerDetail = 'provider body containing account and credential details'
    const validApiKeyAuthorization = `Basic ${Buffer.from(`${API_KEY_SID}:${API_KEY_SECRET}`).toString('base64')}`
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string>).Authorization
      return authorization === validApiKeyAuthorization
        ? new Response(null, { status: 200 })
        : new Response(providerDetail, { status: 401 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTwilioAccountCredentials()

    expect(result).toMatchObject({
      ok: false,
      configuration: {
        apiKeySidConfigured: true,
        apiKeySecretConfigured: true,
        credentialMode: 'auth_token',
      },
      signatureValidation: { bypassEnabled: true },
      accountApi: { status: 'invalid_credentials', credentialsValid: false },
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({
      Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
    })
    expect(JSON.stringify(result)).not.toContain(providerDetail)
  })

  it('reports a valid auth token but remains unhealthy while signature bypass is enabled', async () => {
    configureApiKey()
    vi.stubEnv('TWILIO_SKIP_SIGNATURE_VALIDATION', 'true')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTwilioAccountCredentials()

    expect(result).toMatchObject({
      ok: false,
      signatureValidation: { bypassEnabled: true },
      accountApi: { status: 'valid', credentialsValid: true },
    })
  })

  it('fails closed with a generic unavailable result on transport errors', async () => {
    configureApiKey()
    const fetchMock = vi.fn().mockRejectedValue(new Error(`connection failed for ${API_KEY_SECRET}`))
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTwilioAccountCredentials()

    expect(result).toMatchObject({
      ok: false,
      accountApi: { status: 'unavailable', credentialsValid: null },
    })
    expect(JSON.stringify(result)).not.toContain(API_KEY_SECRET)
  })
})
