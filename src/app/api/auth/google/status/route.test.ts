import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUserEmail: vi.fn(),
  isCurrentUserAdmin: vi.fn(),
  from: vi.fn(),
  hasGoogleOAuthConfig: vi.fn(),
  readOAuthHealth: vi.fn(),
  persistOAuthHealth: vi.fn(),
  getValidAccessTokenResult: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
  isCurrentUserAdmin: mocks.isCurrentUserAdmin,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

vi.mock('@/lib/gmail-sync', () => ({
  hasGoogleOAuthConfig: mocks.hasGoogleOAuthConfig,
  getValidAccessTokenResult: mocks.getValidAccessTokenResult,
}))

vi.mock('@/lib/oauth-health', () => ({
  readOAuthHealth: mocks.readOAuthHealth,
  persistOAuthHealth: mocks.persistOAuthHealth,
}))

import { GET } from './route'

function request(path = '/api/auth/google/status?user_email=ernest@savingkc.com') {
  return new NextRequest(`https://crm.savingkc.com${path}`)
}

function tokenQuery(result: { data: unknown; error: { message: string } | null }) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: async () => result,
        }),
      }),
    }),
  }
}

describe('GET /api/auth/google/status fail-closed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUserEmail.mockResolvedValue('ernest@savingkc.com')
    mocks.isCurrentUserAdmin.mockResolvedValue(true)
    mocks.hasGoogleOAuthConfig.mockReturnValue(true)
    mocks.persistOAuthHealth.mockResolvedValue(undefined)
    mocks.from.mockReturnValue(tokenQuery({
      data: [{
        id: 'tok-1',
        user_email: 'ernest@savingkc.com',
        last_sync_at: '2026-09-18T13:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        scope: 'gmail.readonly',
        refresh_token: 'stored-refresh',
        access_token: 'expired',
        expires_at: '2026-09-01T00:00:00.000Z',
      }],
      error: null,
    }))
  })

  it('rejects an anonymous request', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue(null)

    const response = await GET(request('/api/auth/google/status'))

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not default a missing health row to connected', async () => {
    mocks.readOAuthHealth.mockResolvedValue(null)
    mocks.getValidAccessTokenResult.mockResolvedValue({
      accessToken: null,
      error: 'token_refresh_failed',
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.oauthConfigured).toBe(true)
    expect(body.accounts[0].connection_status).not.toBe('connected')
    expect(body.accounts[0].connection_status).toBe('error')
  })

  it('persists reauthorization_required when the probe sees invalid_grant', async () => {
    mocks.readOAuthHealth.mockResolvedValue(null)
    mocks.getValidAccessTokenResult.mockResolvedValue({
      accessToken: null,
      error: 'reauthorization_required',
    })

    const body = await (await GET(request())).json()

    expect(body.accounts[0].connection_status).toBe('reauthorization_required')
    expect(mocks.persistOAuthHealth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'google',
        userEmail: 'ernest@savingkc.com',
        status: 'reauthorization_required',
      }),
    )
  })

  it('returns the Google mailbox linked to the CRM login when the addresses differ', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue('oauth-review@savingkc.com')
    mocks.readOAuthHealth.mockResolvedValue({
      provider: 'google',
      userEmail: 'savingkc@gmail.com',
      status: 'connected',
      errorCode: null,
      errorMessage: null,
      checkedAt: '2026-09-24T15:00:00.000Z',
    })
    let calls = 0
    mocks.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => {
              calls += 1
              if (calls === 1) return { data: [], error: null }
              return {
                data: [{
                  id: 'tok-review',
                  user_email: 'savingkc@gmail.com',
                  last_sync_at: null,
                  created_at: '2026-09-24T00:00:00.000Z',
                  scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar',
                  refresh_token: 'stored-refresh',
                  access_token: 'access',
                  expires_at: '2026-09-24T16:00:00.000Z',
                }],
                error: null,
              }
            },
          }),
        }),
      }),
    }))

    const response = await GET(request('/api/auth/google/status'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.accounts[0].user_email).toBe('savingkc@gmail.com')
    expect(body.accounts[0].connection_status).toBe('connected')
    expect(body.accounts[0].has_calendar).toBe(true)
  })

  it('keeps stored accounts unhealthy when OAuth env is missing', async () => {
    mocks.hasGoogleOAuthConfig.mockReturnValue(false)
    mocks.readOAuthHealth.mockResolvedValue({
      provider: 'google',
      userEmail: 'ernest@savingkc.com',
      status: 'connected',
      errorCode: null,
      errorMessage: null,
      checkedAt: '2026-09-20T13:00:00.000Z',
    })

    const body = await (await GET(request())).json()

    expect(body.oauthConfigured).toBe(false)
    expect(body.accounts[0].connection_status).not.toBe('connected')
    expect(body.accounts[0].connection_error_code).toBe('google_oauth_not_configured')
    expect(mocks.getValidAccessTokenResult).not.toHaveBeenCalled()
  })
})
