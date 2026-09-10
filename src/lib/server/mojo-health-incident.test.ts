import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sendAlert: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server/operational-sms-alerts', () => ({
  sendMojoIngestionFailureSmsAlert: mocks.sendAlert,
}))

import { recordMojoHealthIncident } from './mojo-health-incident'

function database(recent: unknown[], insertErrors: Array<{ message: string } | null> = [null]) {
  const insert = vi.fn().mockImplementation(() => Promise.resolve({ error: insertErrors.shift() ?? null }))
  const builder = {
    select: () => builder,
    eq: vi.fn(() => builder),
    contains: () => builder,
    gte: () => builder,
    limit: () => builder,
    insert,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: recent, error: null }).then(resolve, reject),
  }
  return { db: { from: () => builder }, insert, eq: builder.eq }
}

describe('Mojo health incident', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendAlert.mockResolvedValue({ attempted: true, recipient: '+18160000001', result: { success: true } })
  })

  it('creates one durable event and sends one alert for a new incident', async () => {
    const { db, insert, eq } = database([])
    const result = await recordMojoHealthIncident(db as never, {
      message: 'Provider snapshot is missing',
      reason: 'health_attention',
      source: 'vercel-mojo-health',
    }, new Date('2026-09-04T19:05:00.000Z'))

    expect(result).toEqual({ created: true, alerted: true })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'system_failure',
      metadata: expect.objectContaining({ system: 'mojo_ingestion' }),
    }))
    expect(mocks.sendAlert).toHaveBeenCalledOnce()
    expect(eq).toHaveBeenCalledWith('description', 'Provider snapshot is missing')
  })

  it('deduplicates repeated monitor failures within six hours', async () => {
    const { db, insert } = database([{ id: 'existing' }])
    const result = await recordMojoHealthIncident(db as never, {
      message: 'Provider snapshot is missing',
      reason: 'health_attention',
      source: 'vercel-mojo-health',
    })

    expect(result).toEqual({ created: false, alerted: false })
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.sendAlert).not.toHaveBeenCalled()
  })

  it('falls back to the legacy event shape when production lacks metadata', async () => {
    const { db, insert } = database([], [
      { message: 'column ari_briefing_events.metadata does not exist' },
      null,
    ])
    const result = await recordMojoHealthIncident(db as never, {
      message: 'Provider snapshot is missing',
      reason: 'provider_unavailable',
      source: 'vercel-mojo-performance',
    })

    expect(result).toEqual({ created: true, alerted: true })
    expect(insert).toHaveBeenCalledTimes(2)
    expect(insert.mock.calls[0][0]).toHaveProperty('metadata')
    expect(insert.mock.calls[1][0]).not.toHaveProperty('metadata')
  })
})
