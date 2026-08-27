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

function bearerRequest(pathname: string) {
  return new NextRequest(`https://crm.savingkc.com${pathname}`, {
    headers: { authorization: 'Bearer test-cron-secret' },
  })
}

describe('enrichment proxy bearer allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } })
  })

  it.each(['/api/enrich', '/api/enrich/batch'])(
    'allows the reviewed server-to-server endpoint %s',
    async (pathname) => {
      const response = await proxy(bearerRequest(pathname), event)

      expect(response.status).toBe(200)
      expect(response.headers.get('x-middleware-next')).toBe('1')
      expect(mocks.createServerClient).not.toHaveBeenCalled()
    },
  )

  it('does not grant bearer trust to a newly added enrichment child route', async () => {
    const response = await proxy(bearerRequest('/api/enrich/unreviewed'), event)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.getClaims).toHaveBeenCalledOnce()
  })
})
