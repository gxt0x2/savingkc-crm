import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  isMojoBusinessHours,
  MojoPerformanceSyncError,
  syncCurrentMojoPerformance,
} from './mojo-performance-sync'

const snapshot = {
  agentKey: 'casey',
  metricDate: '2026-09-08',
  providerAgentId: '1',
  providerTimezone: 'America/Chicago',
  dialingSeconds: 3660,
  inProgressSeconds: 0,
  calls: 121,
  contacts: 9,
  leads: 2,
  appointments: 1,
  source: 'mojo_kpi_historical_daily_v1',
  sourceDigest: 'a'.repeat(64),
  sourceFetchedAt: '2026-09-08T20:00:00.000Z',
}

function database(session: unknown = 'stored-session') {
  const maybeSingle = vi.fn().mockResolvedValue({ data: session === null ? null : { value: session }, error: null })
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle,
    upsert,
  }
  const rpc = vi.fn().mockResolvedValue({ data: { applied: true }, error: null })
  return { db: { from: vi.fn(() => builder), rpc }, upsert, rpc }
}

describe('server-owned Mojo performance synchronization', () => {
  it('preserves the actual provider failure after retries in the saved health reason', async () => {
    const { db, upsert } = database()
    const fetchSnapshot = vi.fn().mockRejectedValue(new Error('Mojo KPI returned invalid dialing time (type=number, value=-1)'))
    await expect(syncCurrentMojoPerformance({ db: db as never, now: new Date('2026-09-08T20:00:00Z'), fetchSnapshot, sleep: vi.fn() }))
      .rejects.toThrow('invalid dialing time')
    expect(upsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'mojo_performance_sync_last_error', value: expect.stringContaining('value=-1') }),
    ]), { onConflict: 'key' })
  })
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.MOJO_SESSION_ID
  })

  it('runs during SavingKC business hours and not during the Labor Day closure', () => {
    expect(isMojoBusinessHours(new Date('2026-09-08T20:00:00.000Z'))).toBe(true)
    expect(isMojoBusinessHours(new Date('2026-09-07T20:00:00.000Z'))).toBe(false)
    expect(isMojoBusinessHours(new Date('2026-12-08T13:30:00.000Z'))).toBe(false)
    expect(isMojoBusinessHours(new Date('2026-12-08T14:30:00.000Z'))).toBe(true)
  })

  it('reads the stored session, fetches today, and writes the authoritative projection', async () => {
    const { db, rpc, upsert } = database()
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot)

    await expect(syncCurrentMojoPerformance({
      db: db as never,
      now: new Date('2026-09-08T20:00:00.000Z'),
      fetchSnapshot,
    })).resolves.toMatchObject({
      ok: true,
      skipped: false,
      metricDate: '2026-09-08',
      calls: 121,
      contacts: 9,
      attempts: 1,
    })

    expect(fetchSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'stored-session',
      metricDate: '2026-09-08',
    }))
    expect(rpc).toHaveBeenCalledWith('upsert_mojo_agent_daily_performance_v1', {
      p_snapshot: expect.objectContaining({ metricDate: '2026-09-08', calls: 121 }),
    })
    expect(upsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'mojo_performance_sync_health', value: 'healthy' }),
      expect.objectContaining({ key: 'mojo_session_status', value: 'healthy' }),
    ]), { onConflict: 'key' })
  })

  it('prefers the refreshable database session over a static environment fallback', async () => {
    process.env.MOJO_SESSION_ID = 'older-environment-session'
    const { db } = database('newer-database-session')
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot)

    await syncCurrentMojoPerformance({
      db: db as never,
      now: new Date('2026-09-08T20:00:00.000Z'),
      fetchSnapshot,
    })

    expect(fetchSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'newer-database-session',
    }))
  })

  it('retries transient provider failures before succeeding', async () => {
    const { db } = database()
    const fetchSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error('Mojo KPI request failed (502)'))
      .mockRejectedValueOnce(new Error('Mojo KPI request failed (503)'))
      .mockResolvedValue(snapshot)
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await syncCurrentMojoPerformance({
      db: db as never,
      now: new Date('2026-09-08T20:00:00.000Z'),
      fetchSnapshot,
      sleep,
    })

    expect(result.attempts).toBe(3)
    expect(fetchSnapshot).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('marks the session and performance feed down when provider auth expires', async () => {
    const { db, upsert } = database()
    const fetchSnapshot = vi.fn().mockRejectedValue(new Error('session_expired: Mojo KPI request returned 403'))

    await expect(syncCurrentMojoPerformance({
      db: db as never,
      now: new Date('2026-09-08T20:00:00.000Z'),
      fetchSnapshot,
      sleep: vi.fn(),
    })).rejects.toMatchObject({ code: 'session_expired' } satisfies Partial<MojoPerformanceSyncError>)

    expect(fetchSnapshot).toHaveBeenCalledOnce()
    expect(upsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'mojo_performance_sync_health', value: 'down' }),
      expect.objectContaining({ key: 'mojo_session_status', value: 'expired' }),
    ]), { onConflict: 'key' })
  })

  it('skips external reads outside business hours unless explicitly forced', async () => {
    const { db } = database()
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot)

    await expect(syncCurrentMojoPerformance({
      db: db as never,
      now: new Date('2026-09-08T23:30:00.000Z'),
      fetchSnapshot,
    })).resolves.toEqual({
      ok: true,
      skipped: true,
      reason: 'outside_business_hours',
      metricDate: '2026-09-08',
    })
    expect(fetchSnapshot).not.toHaveBeenCalled()
  })
})
