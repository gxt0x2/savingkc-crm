import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/overdue-appointment-outcomes', () => ({ listOverdueScheduledAppointments: mocks.list }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: vi.fn() }) }))

import { GET } from './route'

describe('appointment outcome nightly check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.list.mockResolvedValue({
      rows: [{ id: 'appt-1', leadId: 'lead-1', scheduledAt: '2026-09-22T15:00:00.000Z', status: 'scheduled' }],
      error: null,
      cutoff: '2026-09-23T15:00:00.000Z',
    })
  })

  it('returns overdue scheduled appointments without writing', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/appointment-outcomes'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      readOnly: true,
      count: 1,
      cutoff: '2026-09-23T15:00:00.000Z',
    })
    expect(mocks.list).toHaveBeenCalledOnce()
  })

  it('rejects an unsigned caller before reading appointments', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/appointment-outcomes'))
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
