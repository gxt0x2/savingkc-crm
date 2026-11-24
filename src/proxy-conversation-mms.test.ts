import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextFetchEvent } from 'next/server'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}))

import { proxy } from './proxy'

const event = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as NextFetchEvent

function request(pathname: string, headers?: HeadersInit, method = 'GET') {
  return new NextRequest(`https://crm.savingkc.com${pathname}`, { method, headers })
}

describe('inbound MMS proxy gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } })
  })

  it('lets a bearer read reach the handler that verifies the Supabase token', async () => {
    const response = await proxy(request('/api/conversations/mms?path=SM' + 'a'.repeat(32) + '/0-mms-0.jpg', {
      Authorization: 'Bearer verified-token',
    }), event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('keeps an anonymous read on the cookie gate', async () => {
    const response = await proxy(request('/api/conversations/mms'), event)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.getClaims).toHaveBeenCalledOnce()
  })

  it('does not let a bearer skip the cookie gate on other conversation routes', async () => {
    const response = await proxy(request('/api/conversations/timeline', {
      Authorization: 'Bearer verified-token',
    }), event)

    expect(response.status).toBe(401)
    expect(mocks.getClaims).toHaveBeenCalledOnce()
  })

  it('does not let a bearer skip the cookie gate for a non-read of the photo route', async () => {
    const response = await proxy(request('/api/conversations/mms', {
      Authorization: 'Bearer verified-token',
    }, 'POST'), event)

    expect(response.status).toBe(401)
    expect(mocks.getClaims).toHaveBeenCalledOnce()
  })
})
