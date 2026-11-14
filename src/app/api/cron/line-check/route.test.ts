import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  run: vi.fn(),
  client: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/phone-line-check', () => ({ runPhoneLineChecks: mocks.run }))
vi.mock('@/lib/server/phone-line-check-store', () => ({ phoneLineCheckStore: () => ({}) }))
vi.mock('@/lib/server/phone-line-lookup', () => ({
  createTwilioLookupClient: mocks.client,
  lookupPhoneLine: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))

import { GET } from './route'

describe('/api/cron/line-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.client.mockReturnValue({ lookups: {} })
    mocks.run.mockResolvedValue({ ok: true, source: 'cron', checked: 2, failed: 0, skipped: [], stopped: false, cap: null, costUsd: 0.03, remaining: 998 })
  })

  it('uses the existing cron auth and does not call Lookup until that passes', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/line-check'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, source: 'cron', checked: 2 })
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ source: 'cron', actor: 'line-check-cron' }))
  })

  it('starts at 08:00 UTC so the run finishes before the 4am Chicago list lock', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>
    }
    const registry = JSON.parse(readFileSync('src/config/system-registry.json', 'utf8')) as {
      features: Array<{ crons?: Array<{ path: string; schedule: string }> }>
    }
    const schedule = '0 8 * * *'
    expect(vercel.crons.find((cron) => cron.path === '/api/cron/line-check')?.schedule).toBe(schedule)
    expect(registry.features.flatMap((feature) => feature.crons ?? []).find((cron) => cron.path === '/api/cron/line-check')?.schedule).toBe(schedule)
    const source = readFileSync('src/app/api/cron/line-check/route.ts', 'utf8')
    expect(source).toContain('08:00 UTC')
    expect(source).toContain('4:00am America/Chicago')
    expect(source).toContain('2:00am CST')
    expect(source).toContain('3:00am CDT')
  })

  it('rejects an unsigned caller before creating a Twilio client', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/line-check'))
    expect(response.status).toBe(401)
    expect(mocks.client).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
