import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sendAlert: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server/operational-sms-alerts', () => ({
  sendMojoIngestionFailureSmsAlert: mocks.sendAlert,
}))

import { recordMojoHealthIncident } from './mojo-health-incident'

function database(recent: unknown[]) {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const builder = {
    select: () => builder,
    eq: () => builder,
    contains: () => builder,
    gte: () => builder,
    limit: () => builder,
    insert,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: recent, error: null }).then(resolve, reject),
  }
  return { db: { from: () => builder }, insert }
}

describe('Mojo health incident', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendAlert.mockResolvedValue({ attempted: true, recipient: '+18160000001', result: { success: true } })
  })

  it('creates one durable event and sends one alert for a new incident', async () => {
    const { db, insert } = database([])
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
})
