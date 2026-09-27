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

describe('Gmail Pub/Sub webhook route containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-key')
    mocks.getClaims.mockResolvedValue({
      data: null,
      error: new Error('signed out'),
    })
    mocks.createServerClient.mockReturnValue({
      auth: { getClaims: mocks.getClaims },
    })
  })

  it('lets the exact Gmail push route reach its own verifier without a CRM session', async () => {
    const response = await proxy(
      new NextRequest('https://crm.savingkc.com/api/webhooks/google/gmail', { method: 'POST' }),
      event,
    )
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('requires CRM authorization for a lookalike Gmail webhook path', async () => {
    const response = await proxy(
      new NextRequest('https://crm.savingkc.com/api/webhooks/google/gmail-copy', { method: 'POST' }),
      event,
    )
    expect(response.status).toBe(401)
    expect(mocks.getClaims).toHaveBeenCalled()
  })
})
