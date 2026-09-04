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

function database(performance: unknown[]) {
  let leadQuery = 0
  return {
    from: (table: string) => {
      if (table === 'system_config') {
        return query({ data: [
          { key: 'mojo_session_status', value: 'healthy' },
          { key: 'mojo_sync_health', value: 'healthy' },
          { key: 'mojo_sync_last_ok_at', value: '2026-09-04T19:00:00.000Z' },
        ], error: null })
      }
      if (table === 'mojo_call_queue') return query({ data: [], error: null })
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
    expect(health.message).toContain('no provider performance snapshot for 2026-09-04')
    expect(health.performance.latestMetricDate).toBe('2026-09-03')
  })

  it('marks an aging current-day provider snapshot as delayed', async () => {
    const health = await getMojoHealth(database([
      { metric_date: '2026-09-04', source_fetched_at: '2026-09-04T17:35:00.000Z' },
    ]) as never, { now: new Date('2026-09-04T19:05:00.000Z') })

    expect(health.status).toBe('watch')
    expect(health.performance.ageMinutes).toBe(90)
  })
})
