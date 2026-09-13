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
describe('Resend webhook route containment', () => {
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
  it('lets only the exact webhook route reach its signature verifier without CRM login', async () => {
    const response = await proxy(
      new NextRequest('https://crm.savingkc.com/api/webhooks/email/resend', {
        method: 'POST',
      }),
      event,
    )
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
  it('lets the receiving-only worker enforce its dedicated bearer', async () => {
    const response = await proxy(
      new NextRequest('https://crm.savingkc.com/api/workers/email', {
        method: 'POST',
      }),
      event,
    )
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
  it.each([
    '/api/webhooks/email/resend-copy',
    '/api/webhooks/email/resend/admin',
  ])('requires CRM authorization for lookalike %s', async (path) => {
    const response = await proxy(
      new NextRequest(`https://crm.savingkc.com${path}`, { method: 'POST' }),
      event,
    )
    expect(response.status).toBe(401)
  })
})
