import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

describe('POST /api/oauth/token', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('forwards the exchange to Supabase without the unsupported resource indicator', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co/')
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        { access_token: 'opaque-token', token_type: 'bearer' },
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://crm.savingkc.com/api/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic client-credentials',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'authorization-code',
        code_verifier: 'pkce-verifier',
        resource: 'https://crm.savingkc.com/api/mcp',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({ access_token: 'opaque-token', token_type: 'bearer' })
    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const forwardedBody = new URLSearchParams(String(init.body))
    const forwardedHeaders = new Headers(init.headers)
    expect(url).toBe('https://project.supabase.co/auth/v1/oauth/token')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'manual' })
    expect(forwardedHeaders.get('authorization')).toBe('Basic client-credentials')
    expect(forwardedBody.get('code')).toBe('authorization-code')
    expect(forwardedBody.get('code_verifier')).toBe('pkce-verifier')
    expect(forwardedBody.has('resource')).toBe(false)
  })

  it('rejects non-form requests without calling upstream', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://crm.savingkc.com/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    const response = await POST(request)

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
