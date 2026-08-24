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

  it('rejects malformed snapshots without touching the database', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/mojo-performance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calls: -1 }),
    }) as never)
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('upserts one normalized provider snapshot with no-store semantics', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/mojo-performance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot),
    }) as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toEqual({
      ok: true, applied: true, metricDate: '2026-08-24', sourceFetchedAt: '2026-08-24T22:42:00.000Z',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('upsert_mojo_agent_daily_performance_v1', {
      p_snapshot: expect.objectContaining({ calls: 304, contacts: 8, dialingSeconds: 7667.376 }),
    })
  })

  it('fails closed when the projection write is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'database unavailable' } })
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/mojo-performance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot),
    }) as never)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Mojo performance snapshot could not be stored.' })
  })
})
