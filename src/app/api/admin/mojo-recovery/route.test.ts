import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import expectedRuntime from '@/config/mojo-runtime-manifest.json'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), health: vi.fn(), incident: vi.fn() }))
vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.db }))
vi.mock('@/lib/marketing/mojo-health', () => ({ getMojoHealth: mocks.health }))
vi.mock('@/lib/server/mojo-health-incident', () => ({ recordMojoHealthIncident: mocks.incident }))
import { POST } from './route'
const runId = '47e3f248-3461-4d08-80ae-12c72e7a335e'
function database(change = {}) {
  const run = { id: runId, runtime_digest: expectedRuntime.contentDigest, started_at: '2026-09-11T14:55:00Z', status: 'running', attempt_count: 0, ...change }
  const update = vi.fn((patch: Record<string, unknown>): Query => { Object.assign(run, patch); return q })
  const upsert = vi.fn(() => q)
  type Query = {
    select: () => Query; eq: () => Query; lt: () => Query; single: () => Query; maybeSingle: () => Query
    upsert: () => Query; update: (patch: Record<string, unknown>) => Query
    then: (resolve: (value: unknown) => unknown) => Promise<unknown>
  }
  const q: Query = { select: () => q, eq: () => q, lt: () => q, upsert, update, single: () => q, maybeSingle: () => q,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: run, error: null }).then(resolve) }
  return { run, update, upsert, from: () => q }
}
const body = { event: 'attempt', runId, attempts: [{ exitCode: 0, timedOut: false }] }
function request(value = body, digest = expectedRuntime.contentDigest) {
  return new NextRequest('https://crm.savingkc.com/api/admin/mojo-recovery', { method: 'POST', headers: { 'x-mojo-runtime-digest': digest }, body: JSON.stringify(value) })
}
describe('server verification of automatic recovery receipts', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T15:00:00Z')); vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null); mocks.incident.mockResolvedValue({ created: false, alerted: false })
    mocks.health.mockResolvedValue({ status: 'clean', sessionStatus: 'healthy', syncHealth: 'healthy', businessHours: true,
      lastSyncAt: '2026-09-11T14:59:50Z', lastSyncAgeMinutes: 0, runtime: { verified: true },
      performance: { status: 'current', latestMetricDate: '2026-09-11' }, queue: { failed24h: 0, deadLetter: 0 },
      qualification: { recordingFailed7d: 0 }, reconciliation: { error: null, counts: {} } })
  })
  afterEach(() => vi.useRealTimers())
  it('rejects unauthenticated or obsolete runtimes before writing anything', async () => {
    expect((await POST(request(body, 'retired'))).status).toBe(409)
    mocks.auth.mockResolvedValue(new Response(null, { status: 401 }))
    expect((await POST(request())).status).toBe(401)
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('records recovery only from a new intake timestamp and independently checked current-day totals', async () => {
    const db = database(); mocks.db.mockReturnValue(db)
    expect(await (await POST(request())).json()).toMatchObject({ run: { status: 'recovered', attempt_count: 1 } })
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ verification: expect.objectContaining({ intakeVerified: true, performanceVerified: true }) }))
  })
  it('cannot make an old successful sync into proof for a new run', async () => {
    const db = database(); mocks.db.mockReturnValue(db)
    const h = await mocks.health(); mocks.health.mockResolvedValue({ ...h, lastSyncAt: '2026-09-11T14:50:00Z' })
    expect(await (await POST(request())).json()).toMatchObject({ run: { status: 'running', failure_key: 'intake' } })
  })
  it('retains failed verification after three attempts instead of marking a zero-exit run healthy', async () => {
    const db = database(); mocks.db.mockReturnValue(db)
    const h = await mocks.health(); mocks.health.mockResolvedValue({ ...h, performance: { status: 'delayed', latestMetricDate: '2026-09-10' } })
    expect(await (await POST(request({ ...body, attempts: Array(3).fill(body.attempts[0]) }))).json()).toMatchObject({ run: { status: 'exhausted', failure_key: 'performance' } })
  })
  it('keeps a completed receipt immutable on a duplicate request', async () => {
    const db = database({ status: 'recovered', attempt_count: 1 }); mocks.db.mockReturnValue(db)
    await POST(request())
    expect(db.update).not.toHaveBeenCalled(); expect(mocks.health).toHaveBeenCalledOnce()
  })
  it('rejects a child that finishes after its entire recovery deadline', async () => {
    const db = database({ started_at: '2026-09-11T14:30:00Z' }); mocks.db.mockReturnValue(db)
    expect((await POST(request())).status).toBe(409)
    expect(db.update).not.toHaveBeenCalled()
  })
  it('rejects a receipt with more than three attempts', async () => {
    expect((await POST(request({ ...body, attempts: Array(4).fill(body.attempts[0]) }))).status).toBe(400)
    expect(mocks.db).not.toHaveBeenCalled()
  })
})
