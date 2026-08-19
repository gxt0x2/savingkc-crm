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

function request(method: string) {
  return new NextRequest('https://crm.savingkc.com/api/leads', { method })
}

const event = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as NextFetchEvent

describe('/api/leads proxy containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } })
  })

  it.each(['POST', 'OPTIONS'])('keeps seller-intake %s public', async (method) => {
    const response = await proxy(request(method), event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it.each(['GET', 'PATCH', 'DELETE'])('rejects anonymous %s', async (method) => {
    const response = await proxy(request(method), event)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.getClaims).toHaveBeenCalledOnce()
  })

  it('allows an authenticated GET through to the route handler', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'user-123' } }, error: null })

    const response = await proxy(request('GET'), event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})
