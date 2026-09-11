import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sync: vi.fn(),
  incident: vi.fn(),
  db: {},
  SyncError: class extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'MojoPerformanceSyncError'
    }
  },
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/mojo-performance-sync', () => ({
  MojoPerformanceSyncError: mocks.SyncError,
  syncCurrentMojoPerformance: mocks.sync,
}))
vi.mock('@/lib/server/mojo-health-incident', () => ({ recordMojoHealthIncident: mocks.incident }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mocks.db }))

import { GET } from './route'

describe('/api/cron/sync-mojo-performance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.sync.mockResolvedValue({
      ok: true,
      skipped: false,
      metricDate: '2026-09-08',
      sourceFetchedAt: '2026-09-08T20:00:00.000Z',
      applied: true,
      attempts: 1,
      calls: 121,
      contacts: 9,
      leads: 2,
      appointments: 1,
    })
    mocks.incident.mockResolvedValue({ created: true, alerted: true })
  })

  it('rejects an untrusted cron request before syncing', async () => {
    mocks.auth.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/sync-mojo-performance') as never)
    expect(response.status).toBe(401)
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('returns the current provider watermark with no-store semantics', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/sync-mojo-performance') as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      metricDate: '2026-09-08',
      calls: 121,
    })
  })

  it('records and reports an expired stored session without leaking it', async () => {
    mocks.sync.mockRejectedValue(new mocks.SyncError(
      'session_expired',
      'The stored Mojo session is no longer valid',
    ))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/sync-mojo-performance') as never)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'session_expired',
      error: "Today's Mojo performance could not be refreshed.",
      actionRequired: 'retry_automatically',
    })
    expect(mocks.incident).toHaveBeenCalledWith(mocks.db, expect.objectContaining({
      reason: 'session_expired',
      source: 'vercel-mojo-performance',
    }))
  })
})
