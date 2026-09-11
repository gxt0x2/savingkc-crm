import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

describe('POST /api/oauth/register', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('forwards dynamic client registration to Supabase', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co/')
    const registeredClient = { client_id: 'grok-client', client_secret: 'secret' }
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(registeredClient, {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const body = JSON.stringify({
      client_name: 'Grok Bot',
      redirect_uris: ['http://localhost:8787/callback'],
      token_endpoint_auth_method: 'none',
    })
    const request = new Request('https://crm.savingkc.com/api/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual(registeredClient)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/oauth/clients/register',
      expect.objectContaining({ method: 'POST', body, cache: 'no-store', redirect: 'manual' }),
    )
  })

  it('rejects non-JSON requests without calling upstream', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://crm.savingkc.com/api/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'invalid',
    })

    const response = await POST(request)

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({ error: 'invalid_client_metadata' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
