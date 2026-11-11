import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(),
  bearer: vi.fn(),
  from: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.cookie,
}))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.bearer,
}))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from: mocks.from } }),
}))

import { GET } from './route'

const path = `SM${'a'.repeat(32)}/0-mms-0.jpg`
const url = `https://crm.savingkc.com/api/conversations/mms?path=${encodeURIComponent(path)}`

function cookieDenied() {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  )
}

describe('GET /api/conversations/mms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockReturnValue({ download: mocks.download })
    mocks.download.mockResolvedValue({
      data: {
        type: 'image/jpeg',
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      },
      error: null,
    })
  })

  it('serves a private photo for a cookie session', async () => {
    mocks.cookie.mockResolvedValue(null)

    const response = await GET(new Request(url))

    expect(response.status).toBe(200)
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3])
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(mocks.bearer).not.toHaveBeenCalled()
    expect(mocks.from).toHaveBeenCalledWith('inbound-mms')
    expect(mocks.download).toHaveBeenCalledWith(path)
  })

  it('serves the same photo for a verified Supabase bearer token', async () => {
    mocks.cookie.mockResolvedValue(cookieDenied())
    mocks.bearer.mockResolvedValue({ accessToken: 'verified-token', user: { id: 'user-1' } })
    const request = new Request(url, { headers: { Authorization: 'Bearer verified-token' } })

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.bearer).toHaveBeenCalledWith(request)
    expect(mocks.download).toHaveBeenCalledWith(path)
  })

  it('returns 401 when neither a cookie session nor a bearer token is present', async () => {
    mocks.cookie.mockResolvedValue(cookieDenied())
    mocks.bearer.mockRejectedValue(new (await import('@/lib/mobile-api/auth')).MobileAuthError('Missing bearer token'))

    const response = await GET(new Request(url))

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('returns 404 for an unsafe path before touching storage', async () => {
    mocks.cookie.mockResolvedValue(null)

    const response = await GET(new Request('https://crm.savingkc.com/api/conversations/mms?path=../secrets.jpg'))

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
