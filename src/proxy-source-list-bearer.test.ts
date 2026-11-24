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

describe('source list import proxy bearer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } })
  })

  it('lets the box reach the import route with the cron secret', async () => {
    const response = await proxy(new NextRequest('https://crm.savingkc.com/api/source-lists/import', {
      method: 'POST',
      headers: { authorization: 'Bearer test-cron-secret' },
    }), event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('does not grant that bearer to the dialer export', async () => {
    const response = await proxy(new NextRequest('https://crm.savingkc.com/api/source-lists/dialer-export', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }), event)

    expect(response.status).toBe(401)
  })
})
