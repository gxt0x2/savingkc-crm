import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getCurrentUserEmail: vi.fn(),
  verifyTwilioAccountCredentials: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/support/twilio-verification', () => ({
  verifyTwilioAccountCredentials: mocks.verifyTwilioAccountCredentials,
}))

import { GET } from './route'

let actorProfile: { role: string | null; is_admin: boolean | null } | null
let profileError: { message: string } | null

function request(headers?: HeadersInit) {
  return new NextRequest('https://crm.savingkc.com/api/support/twilio/verify', { headers })
}

function expectNoStore(response: Response) {
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.get('cdn-cache-control')).toBe('no-store')
  expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store')
  expect(response.headers.get('pragma')).toBe('no-cache')
  expect(response.headers.get('expires')).toBe('0')
}

describe('owner/admin Twilio verification route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actorProfile = { role: 'owner', is_admin: false }
    profileError = null
    mocks.getCurrentUserEmail.mockResolvedValue('owner@savingkc.com')
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe('agent_profiles')
      return {
        select: (fields: string) => {
          expect(fields).toBe('role, is_admin')
          return {
            eq: (field: string, value: string) => {
              expect(field).toBe('email')
              expect(value).toBe('owner@savingkc.com')
              return {
                maybeSingle: async () => ({ data: actorProfile, error: profileError }),
              }
            },
          }
        },
      }
    })
    mocks.verifyTwilioAccountCredentials.mockResolvedValue({
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
  })

  it('does not let a health bearer substitute for an authenticated CRM user', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue(null)

    const response = await GET(request({ Authorization: 'Bearer synthetic-health-bearer' }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expectNoStore(response)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.verifyTwilioAccountCredentials).not.toHaveBeenCalled()
  })

  it('rejects a signed-in regular user before making a Twilio request', async () => {
    actorProfile = { role: 'agent', is_admin: false }

    const response = await GET(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expectNoStore(response)
    expect(mocks.verifyTwilioAccountCredentials).not.toHaveBeenCalled()
  })

  it.each([
    ['owner', { role: 'owner', is_admin: false }],
    ['admin', { role: 'agent', is_admin: true }],
  ])('allows an authenticated %s to run the read-only verification', async (_label, profile) => {
    actorProfile = profile

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(body).toMatchObject({
      ok: true,
      signatureValidation: { bypassEnabled: false },
      accountApi: { status: 'valid', credentialsValid: true },
    })
    expect(body).not.toHaveProperty('token')
    expect(body).not.toHaveProperty('phone')
    expect(mocks.verifyTwilioAccountCredentials).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the authorization profile cannot be loaded', async () => {
    profileError = { message: 'database unavailable' }

    const response = await GET(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Authorization unavailable' })
    expectNoStore(response)
    expect(mocks.verifyTwilioAccountCredentials).not.toHaveBeenCalled()
  })

  it('returns an unhealthy diagnostic as no-store without exposing additional data', async () => {
    mocks.verifyTwilioAccountCredentials.mockResolvedValue({
      ok: false,
      configuration: {
        accountSidConfigured: true,
        apiKeySidConfigured: true,
        apiKeySecretConfigured: true,
        authTokenConfigured: true,
        credentialMode: 'auth_token',
      },
      signatureValidation: { bypassEnabled: true },
      accountApi: { status: 'invalid_credentials', credentialsValid: false },
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expectNoStore(response)
    expect(body).toEqual({
      ok: false,
      configuration: {
        accountSidConfigured: true,
        apiKeySidConfigured: true,
        apiKeySecretConfigured: true,
        authTokenConfigured: true,
        credentialMode: 'auth_token',
      },
      signatureValidation: { bypassEnabled: true },
      accountApi: { status: 'invalid_credentials', credentialsValid: false },
    })
  })
})
