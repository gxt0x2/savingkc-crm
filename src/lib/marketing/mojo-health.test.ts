import { describe, expect, it } from 'vitest'

import { getMojoHealth } from './mojo-health'

type Response = { data: unknown[]; error: { message: string } | null }

function query(response: Response) {
  const builder = {
    select: () => builder,
    in: () => builder,
    gte: () => builder,
    lt: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (value: Response) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(response).then(resolve, reject),
  }
  return builder
}

function database(performance: unknown[], config = [
  { key: 'mojo_session_status', value: 'healthy' },
  { key: 'mojo_sync_health', value: 'healthy' },
  { key: 'mojo_sync_last_ok_at', value: '2026-09-04T19:00:00.000Z' },
], queueRows: unknown[] = [], eventRows: unknown[] = []) {
  let leadQuery = 0
  return {
    from: (table: string) => {
      if (table === 'system_config') {
        return query({ data: config, error: null })
      }
      if (table === 'mojo_call_queue') return query({ data: queueRows, error: null })
      if (table === 'crm_mojo_call_events') return query({ data: eventRows, error: null })
      if (table === 'leads') {
        leadQuery += 1
        return query({ data: leadQuery ? [] : [], error: null })
      }
      return query({ data: performance, error: null })
    },
  }
}

describe('Mojo health data watermark', () => {
  it('raises attention when the job reports success but today has no provider snapshot', async () => {
    const health = await getMojoHealth(database([
      { metric_date: '2026-09-03', source_fetched_at: '2026-09-03T19:00:00.000Z' },
    ]) as never, { now: new Date('2026-09-04T19:05:00.000Z') })

    expect(health.status).toBe('attention')
    expect(health.message).toBe('Mojo provider performance was last updated Sep 3, 2:00 PM')
    expect(health.performance.latestMetricDate).toBe('2026-09-03')
  })

  it('uses the last update time instead of exposing a raw date key', async () => {
    const health = await getMojoHealth(database([
      { metric_date: '2026-09-04', source_fetched_at: '2026-09-07T22:59:00.000Z' },
    ]) as never, { now: new Date('2026-09-08T16:30:00.000Z') })

    expect(health.status).toBe('attention')
    expect(health.message).toBe('Mojo provider performance was last updated Sep 7, 5:59 PM')
    expect(health.message).not.toContain('2026-09-08')
  })

  it('does not expect provider snapshots during the Labor Day closure', async () => {
    const health = await getMojoHealth(database([
      { metric_date: '2026-09-04', source_fetched_at: '2026-09-04T22:00:00.000Z' },
    ]) as never, { now: new Date('2026-09-07T16:30:00.000Z') })

    expect(health.businessHours).toBe(false)
    expect(health.status).toBe('clean')
  })

  it('marks an aging current-day provider snapshot as delayed', async () => {
    const health = await getMojoHealth(database([
      { metric_date: '2026-09-04', source_fetched_at: '2026-09-04T17:35:00.000Z' },
    ]) as never, { now: new Date('2026-09-04T19:05:00.000Z') })

    expect(health.status).toBe('watch')
    expect(health.performance.status).toBe('delayed')
    expect(health.performance.ageMinutes).toBe(90)
  })

  it('keeps current provider totals available when an unrelated event sync is down', async () => {
    const health = await getMojoHealth(database([
      { metric_date: '2026-09-08', source_fetched_at: '2026-09-08T19:55:00.000Z' },
    ], [
      { key: 'mojo_session_status', value: 'healthy' },
      { key: 'mojo_sync_health', value: 'down' },
      { key: 'mojo_sync_last_error', value: 'Contact event sync is delayed' },
    ]) as never, { now: new Date('2026-09-08T20:00:00.000Z') })

    expect(health.status).toBe('attention')
    expect(health.performance.status).toBe('current')
    expect(health.performance.message).toBe('Mojo provider performance is current')
  })

  it('surfaces calls that are durably waiting for recording evidence', async () => {
    const health = await getMojoHealth(database(
      [{ metric_date: '2026-09-08', source_fetched_at: '2026-09-08T22:55:00.000Z' }],
      [
        { key: 'mojo_session_status', value: 'healthy' },
        { key: 'mojo_sync_health', value: 'healthy' },
        { key: 'mojo_sync_last_ok_at', value: '2026-09-08T22:55:00.000Z' },
      ],
      [{ status: 'waiting_evidence', created_at: '2026-09-08T22:30:00.000Z' }],
    ) as never, { now: new Date('2026-09-08T23:00:00.000Z') })

    expect(health.qualification.evidencePending24h).toBe(1)
    expect(health.status).toBe('watch')
    expect(health.message).toBe('Mojo ingestion has 1 active item')
  })
})
