import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { DELETE, GET, OPTIONS, PATCH, POST } from './route'

function jsonRequest(method: string, body?: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/leads', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/leads route-local containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuthenticatedUser.mockResolvedValue(
      Response.json({ success: false, error: 'Unauthorized' }, {
        status: 401,
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      }),
    )
  })

  it.each([
    ['GET', () => GET(jsonRequest('GET'))],
    ['PATCH', () => PATCH(jsonRequest('PATCH', { id: 'lead-1', station: 'contacted' }))],
    ['DELETE', () => DELETE(jsonRequest('DELETE', { ids: ['lead-1'] }))],
  ])('rejects anonymous %s before database access', async (_method, invoke) => {
    const response = await invoke()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Unauthorized' })
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('keeps public seller-intake POST available without a session', async () => {
    const response = await POST(jsonRequest('POST', {}))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Phone, address, or email is required' })
    expect(mocks.requireAuthenticatedUser).not.toHaveBeenCalled()
  })

  it('keeps public preflight limited to POST and OPTIONS', async () => {
    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    expect(mocks.requireAuthenticatedUser).not.toHaveBeenCalled()
  })

  it('allows an authenticated GET to reach the leads query', async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 })
    const order = vi.fn(() => ({ range }))
    const select = vi.fn(() => ({ order }))
    mocks.requireAuthenticatedUser.mockResolvedValue(null)
    mocks.from.mockReturnValue({ select })

    const response = await GET(jsonRequest('GET'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, leads: [], total: 0 })
    expect(mocks.from).toHaveBeenCalledWith('leads')
  })
})
