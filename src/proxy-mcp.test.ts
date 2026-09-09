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

describe('/api/mcp proxy containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('PREVIEW_ALLOW_WRITES', 'false')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error('signed out') })
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } })
  })

  it.each(['GET', 'POST'])('lets MCP %s reach the route-level bearer check', async (method) => {
    const request = new NextRequest('https://crm.savingkc.com/api/mcp', { method })
    const response = await proxy(request, event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it.each([
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
  ])('exposes the exact OAuth discovery route %s', async (pathname) => {
    const request = new NextRequest(`https://crm.savingkc.com${pathname}`)
    const response = await proxy(request, event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it.each([
    ['GET', '/api/oauth/authorize'],
    ['POST', '/api/oauth/register'],
    ['POST', '/api/oauth/token'],
  ])('lets the fixed OAuth bridge %s %s bypass CRM session auth', async (method, pathname) => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const request = new NextRequest(`https://crm.savingkc.com${pathname}`, { method })
    const response = await proxy(request, event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('does not expose lookalike OAuth discovery paths', async () => {
    const request = new NextRequest('https://crm.savingkc.com/.well-known/oauth-protected-resource-copy')
    const response = await proxy(request, event)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login?')
    expect(mocks.createServerClient).toHaveBeenCalledOnce()
  })

  it('does not expose a lookalike authorization-server discovery path', async () => {
    const pathname = '/.well-known/oauth-authorization-server-copy'
    const request = new NextRequest(`https://crm.savingkc.com${pathname}`)
    const response = await proxy(request, event)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login?')
    expect(mocks.createServerClient).toHaveBeenCalledOnce()
  })

  it('does not expose a lookalike OAuth API path', async () => {
    const request = new NextRequest('https://crm.savingkc.com/api/oauth/token-copy')
    const response = await proxy(request, event)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.createServerClient).toHaveBeenCalledOnce()
  })
})
