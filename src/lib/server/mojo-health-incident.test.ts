import { beforeEach, describe, expect, it, vi } from 'vitest'
import expectedRuntime from '@/config/mojo-runtime-manifest.json'
const mocks = vi.hoisted(() => ({ sendAlert: vi.fn(), health: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/marketing/mojo-health', () => ({ getMojoHealth: mocks.health }))
vi.mock('@/lib/server/operational-sms-alerts', () => ({ sendMojoIngestionFailureSmsAlert: mocks.sendAlert }))
import { recordMojoHealthIncident } from './mojo-health-incident'
const now = new Date('2026-09-11T15:00:00Z')
const input = { message: 'Unverified local symptom', reason: 'sync_failed', source: 'mojo-supervisor' }
const healthy = () => ({ status: 'clean', sessionStatus: 'healthy', syncHealth: 'healthy', businessHours: true,
  lastSyncAgeMinutes: 1, runtime: { verified: true }, performance: { status: 'current' },
  queue: { failed24h: 0, deadLetter: 0 }, qualification: { recordingFailed7d: 0 },
  reconciliation: { error: null, counts: {} } })
const failure = () => ({ ...healthy(), status: 'attention', sessionStatus: 'expired', lastError: 'Session renewal failed' })

// Query filters and unique-open enforcement model the concurrency boundary; the migration is also rehearsed in PostgreSQL.
function database(exhausted = false, legacy = false) {
  const tables: Record<string, Array<Record<string, unknown>>> = { mojo_recovery_runs: exhausted ? [{
    id: 'r', runtime_digest: expectedRuntime.contentDigest, started_at: '2026-09-11T14:50:00Z',
    status: 'exhausted', attempt_count: 3, failure_key: 'session', completed_at: '2026-09-11T15:00:00Z',
  }] : [], mojo_recovery_incidents: [], ari_briefing_events: [] }
  return { tables, from: (name: string) => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = []; let op = ''; let patch: Record<string, unknown> = {}; let single = false
    type Query = {
      select: () => Query; order: () => Query; limit: () => Query
      eq: (k: string, v: unknown) => Query; is: (k: string, v: unknown) => Query
      update: (v: Record<string, unknown>) => Query; insert: (v: Record<string, unknown>) => Query
      maybeSingle: () => Query; single: () => Query
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise<unknown>
    }
    const q: Query = {
      select: () => q, order: () => q, limit: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q },
      update: (v: Record<string, unknown>) => { op = 'update'; patch = v; return q },
      insert: (v: Record<string, unknown>) => { op = 'insert'; patch = v; return q },
      maybeSingle: () => { single = true; return q },
      single: () => { single = true; return q },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(() => {
        let data: Array<Record<string, unknown>> = []
        if (op === 'insert') {
          if (name === 'mojo_recovery_incidents' && tables[name].some(r => r.status === 'open')) return { data: null, error: { code: '23505' } }
          if (legacy && name === 'ari_briefing_events' && patch.metadata) return { error: { message: 'column ari_briefing_events.metadata does not exist' } }
          const row = { id: `id-${tables[name].length}`, status: 'open', alert_claimed_at: null, ...patch }
          tables[name].push(row)
          data = [row]
        } else {
          data = tables[name].filter(r => filters.every(f => f(r)))
          if (op === 'update') data.forEach((r: Record<string, unknown>) => Object.assign(r, patch))
        }
        return { data: single ? data[0] ?? null : data, error: null }
      }).then(resolve, reject),
    }; return q
  }, rpc: vi.fn() }
}

describe('one recovery gate for every Mojo alert producer', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.health.mockResolvedValue(failure()); mocks.sendAlert.mockResolvedValue({ result: { success: true } }) })
  it('records a new failure without sending an immediate text', async () => {
    const db = database()
    expect(await recordMojoHealthIncident(db as never, input, now)).toEqual({ created: false, alerted: false })
    expect(db.tables.mojo_recovery_incidents).toHaveLength(1)
    expect(mocks.sendAlert).not.toHaveBeenCalled()
  })
  it('does not escalate an obsolete subprocess symptom after fresh health recovers', async () => {
    const db = database(); mocks.health.mockResolvedValue(healthy())
    await recordMojoHealthIncident(db as never, input, now)
    expect(db.tables.mojo_recovery_incidents).toHaveLength(0)
    expect(mocks.sendAlert).not.toHaveBeenCalled()
  })
  it('sends one escalation after three failed attempts even with concurrent producers and legacy ARI schema', async () => {
    const db = database(true, true)
    await Promise.all([recordMojoHealthIncident(db as never, input, now), recordMojoHealthIncident(db as never, { ...input, source: 'vercel-mojo-performance' }, now)])
    expect(mocks.sendAlert).toHaveBeenCalledOnce()
    expect(db.tables.ari_briefing_events).toHaveLength(1)
    expect(mocks.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Three automatic recovery attempts failed') }))
    await recordMojoHealthIncident(db as never, input, new Date('2026-09-11T21:00:00Z'))
    expect(mocks.sendAlert).toHaveBeenCalledOnce()
  })
  it('closes the episode on verified recovery and can escalate a separate recurrence', async () => {
    const db = database(true)
    await recordMojoHealthIncident(db as never, input, now)
    mocks.health.mockResolvedValue(healthy())
    await recordMojoHealthIncident(db as never, input, now)
    expect(db.tables.mojo_recovery_incidents[0].status).toBe('resolved')
    expect(db.tables.ari_briefing_events[0].dismissed).toBe(true)
    mocks.health.mockResolvedValue(failure())
    await recordMojoHealthIncident(db as never, input, new Date('2026-09-11T15:01:00Z'))
    expect(mocks.sendAlert).toHaveBeenCalledOnce()
    db.tables.mojo_recovery_runs[0].completed_at = '2026-09-11T15:02:00Z'
    await recordMojoHealthIncident(db as never, input, new Date('2026-09-11T15:02:00Z'))
    expect(mocks.sendAlert).toHaveBeenCalledTimes(2)
  })
  it('escalates when the collector cannot return a receipt within the recovery deadline', async () => {
    const db = database()
    await recordMojoHealthIncident(db as never, input, new Date('2026-09-11T14:25:00Z'))
    await recordMojoHealthIncident(db as never, input, now)
    expect(mocks.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('powered on') }))
  })
  it('retains ambiguous SMS delivery without repeatedly texting the same episode', async () => {
    const db = database(true)
    mocks.sendAlert.mockRejectedValue(new Error('delivery status unknown'))
    await expect(recordMojoHealthIncident(db as never, input, now)).rejects.toThrow('delivery status unknown')
    await recordMojoHealthIncident(db as never, input, now)
    expect(mocks.sendAlert).toHaveBeenCalledOnce()
    expect(db.tables.mojo_recovery_incidents[0].sms_status).toBe('unknown')
  })
})
