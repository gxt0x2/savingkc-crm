import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))

import { GET } from './route'

describe('GET /api/cron/market-check', () => {
  beforeEach(() => {
    mocks.auth.mockReset()
  })

  it('uses the standard admin or secret check and does not invent a cron secret', async () => {
    mocks.auth.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/cron/market-check', {
      headers: { 'user-agent': 'vercel-cron/1.0' },
    }))
    expect(response.status).toBe(401)
    expect(mocks.auth).toHaveBeenCalled()
  })

  it('skips the load window and tells the caller to use the admin path', async () => {
    mocks.auth.mockResolvedValue(null)
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/cron/market-check'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    if (body.skipped) expect(body.load).toContain('load-market-check-csv')
  })
})
