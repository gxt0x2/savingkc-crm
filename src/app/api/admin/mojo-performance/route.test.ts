import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))

import { POST } from './route'

const snapshot = {
  agentKey: 'casey',
  metricDate: '2026-08-24',
  providerAgentId: '1',
  providerTimezone: 'America/Chicago',
  dialingSeconds: 7667.376,
  inProgressSeconds: 0,
  calls: 304,
  contacts: 8,
  leads: 0,
  appointments: 0,
  source: 'mojo_kpi_historical_daily_v1',
  sourceDigest: 'a'.repeat(64),
  sourceFetchedAt: '2026-08-24T22:42:00.000Z',
}

describe('/api/admin/mojo-performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.rpc.mockResolvedValue({ data: { applied: true }, error: null })
  })

  it('rejects an untrusted request before parsing or writing', async () => {
    mocks.auth.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/mojo-performance', {
      method: 'POST', body: '{',
    }) as never)
    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([snapshot, { calls: -1 }])('rejects the retired writer without changing performance', async body => {
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/mojo-performance', { method: 'POST', body: JSON.stringify(body) }) as never)
    expect(response.status).toBe(410)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
