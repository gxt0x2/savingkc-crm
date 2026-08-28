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

function bearerRequest(pathname: string, method = 'GET') {
  return new NextRequest(`https://crm.savingkc.com${pathname}`, {
    method,
    headers: { authorization: 'Bearer test-cron-secret' },
  })
}

describe('deal ledger proxy bearer allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } })
  })

  it('allows the reviewed Deal File ledger endpoint', async () => {
    const response = await proxy(bearerRequest('/api/deal-ledger', 'POST'), event)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it.each(['/api/deal-ledger/unreviewed', '/api/deal-ledgers'])(
    'does not grant service-bearer trust to the lookalike route %s',
    async (pathname) => {
      const response = await proxy(bearerRequest(pathname, 'POST'), event)
      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
      expect(mocks.getClaims).toHaveBeenCalledOnce()
    },
  )
})
