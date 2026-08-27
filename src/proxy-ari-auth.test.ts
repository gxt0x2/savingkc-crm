import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextFetchEvent } from 'next/server'

vi.hoisted(() => {
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.VERCEL_ENV = 'production'
})

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

const ariRoutes = [
  '/api/ari/chat',
  '/api/ari/deal-score-analysis',
  '/api/ari/extract-pain-points',
  '/api/ari/generate-briefing',
]

function request(pathname: string, bearer = false) {
  return new NextRequest(`https://crm.savingkc.com${pathname}`, bearer
    ? { headers: { authorization: 'Bearer test-cron-secret' } }
    : undefined)
}

describe('ARI proxy authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } })
  })

  it.each(ariRoutes)('rejects bearer-only access to %s', async (pathname) => {
    const response = await proxy(request(pathname, true), event)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.getClaims).toHaveBeenCalledOnce()
  })

  it.each(ariRoutes)('allows a verified signed-in user to reach %s', async (pathname) => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'user-123' } }, error: null })

    const response = await proxy(request(pathname), event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})
