import { describe, expect, it } from 'vitest'

import { normalizeMojoPerformanceSnapshot } from './mojo-performance'

const snapshot = {
  agentKey: 'Casey',
  metricDate: '2026-08-24',
  providerAgentId: '1',
  providerTimezone: 'America/Chicago',
  dialingSeconds: 7667.376345,
  inProgressSeconds: 0,
  calls: 304,
  contacts: 8,
  leads: 0,
  appointments: 0,
  source: 'mojo_kpi_historical_daily_v1',
  sourceDigest: 'a'.repeat(64),
  sourceFetchedAt: '2026-08-24T22:42:00.000Z',
}

describe('Mojo daily performance contract', () => {
  it('normalizes the authoritative dashboard totals without contact facts', () => {
    expect(normalizeMojoPerformanceSnapshot(snapshot)).toEqual({
      ...snapshot,
      agentKey: 'casey',
      dialingSeconds: 7667.376,
    })
  })

  it.each([
    { ...snapshot, calls: -1 },
    { ...snapshot, contacts: 2.5 },
    { ...snapshot, providerTimezone: 'UTC' },
    { ...snapshot, sourceDigest: 'not-a-digest' },
    { ...snapshot, sourceFetchedAt: 'not-a-date' },
  ])('rejects malformed or out-of-contract snapshots', (value) => {
    expect(() => normalizeMojoPerformanceSnapshot(value)).toThrow('invalid_mojo_performance_snapshot')
  })
})
