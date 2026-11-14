import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/telephony/caller-id-health-run', () => ({
  runCallerIdHealth: mocks.run,
  CallerIdHealthError: class CallerIdHealthError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))
vi.mock('@/lib/telephony/caller-id-health-db', () => ({ callerIdHealthStore: () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))

import { CallerIdHealthError } from '@/lib/telephony/caller-id-health-run'
import { GET } from './route'

describe('/api/cron/caller-id-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.run.mockResolvedValue({
      ok: true,
      applied: true,
      skipped: null,
      activeSet: ['+18166404701', '+18165788107', '+18166536616'],
      actions: [],
    })
  })

  it('rejects an untrusted request before reading call history', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/caller-id-health') as never)
    expect(response.status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('returns the active set with no-store semantics', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/caller-id-health') as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      applied: true,
      activeSet: ['+18166404701', '+18165788107', '+18166536616'],
    })
  })

  it('does not rest numbers when the dial history is truncated', async () => {
    mocks.run.mockRejectedValue(new CallerIdHealthError('dial_window_truncated', 'Caller ID dial history was truncated, so no number was rested.'))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/caller-id-health') as never)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'dial_window_truncated' })
  })
})
