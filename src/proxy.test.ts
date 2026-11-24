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
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it.each(['GET', 'PATCH', 'DELETE'])('rejects anonymous %s', async (method) => {
    const response = await proxy(request(method), event)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.getClaims).toHaveBeenCalledOnce()
  })

  it('allows an authenticated GET through to the route handler', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'user-123' } }, error: null })

    const response = await proxy(request('GET'), event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  it.each(['/product', '/privacy', '/terms'])('keeps Google OAuth branding page %s public', async (pathname) => {
    const response = await proxy(
      new NextRequest(`https://crm.savingkc.com${pathname}`),
      event,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('serves the CRM icon font without invoking authenticated session handling', async () => {
    const response = await proxy(
      new NextRequest('https://crm.savingkc.com/fonts/material-symbols-savingkc.ttf'),
      event,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('serves a disallow-all robots.txt without a session or login redirect', async () => {
    const response = await proxy(new NextRequest('https://crm.savingkc.com/robots.txt'), event)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    await expect(response.text()).resolves.toBe('User-agent: *\nDisallow: /\n')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('marks the login wall and anonymous app redirects noindex without opening them', async () => {
    const login = await proxy(new NextRequest('https://crm.savingkc.com/login'), event)
    expect(login.status).toBe(200)
    expect(login.headers.get('x-robots-tag')).toBe('noindex, nofollow')

    const dashboard = await proxy(new NextRequest('https://crm.savingkc.com/dashboard'), event)
    expect(dashboard.status).toBe(307)
    expect(dashboard.headers.get('location')).toContain('/login?redirect=%2Fdashboard')
    expect(dashboard.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  it.each(['/product', '/privacy', '/terms'])('leaves Google OAuth branding page %s indexable', async (pathname) => {
    const response = await proxy(new NextRequest(`https://crm.savingkc.com${pathname}`), event)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-robots-tag')).toBeNull()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
})
