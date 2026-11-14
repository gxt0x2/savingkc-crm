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

describe('caller ID reputation log proxy gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } })
  })

  it.each(['GET', 'POST'])('lets %s reach the route-level secret check', async (method) => {
    const response = await proxy(
      new NextRequest('https://crm.savingkc.com/api/ops/caller-id-reputation/log', {
        method,
        headers: { authorization: 'Bearer caller-id-log-secret' },
      }),
      event,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it.each([
    '/api/ops/caller-id-reputation',
    '/api/ops/caller-id-reputation/log/extra',
    '/api/ops/caller-id-reputation-log',
  ])('does not open the lookalike path %s', async (pathname) => {
    const response = await proxy(
      new NextRequest(`https://crm.savingkc.com${pathname}`, {
        method: 'POST',
        headers: { authorization: 'Bearer caller-id-log-secret' },
      }),
      event,
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.getClaims).toHaveBeenCalledOnce()
  })
})
