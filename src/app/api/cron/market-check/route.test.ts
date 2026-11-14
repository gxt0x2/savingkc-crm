import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/admin', () => ({ isCurrentUserAdmin: vi.fn(async () => false) }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))

import { GET } from './route'

describe('GET /api/cron/market-check', () => {
  it('does not require CRON_SECRET and still rejects a stranger', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/cron/market-check'))
    expect(response.status).toBe(401)
  })

  it('accepts the Vercel cron caller without a secret', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/cron/market-check', {
      headers: { 'user-agent': 'vercel-cron/1.0' },
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
  })
})
