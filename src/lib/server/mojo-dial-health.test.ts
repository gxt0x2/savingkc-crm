import { describe, expect, it } from 'vitest'
import { readMojoCallIngestHealth, type MojoDialHealthDb } from './mojo-dial-health'

function db(options: { okAt?: string | null; callAt?: string | null; error?: string }): MojoDialHealthDb {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => options.error
                  ? { data: null, error: { message: options.error } }
                  : { data: { value: options.okAt ?? null }, error: null },
              }
            },
            order() {
              return {
                limit() {
                  return {
                    maybeSingle: async () => options.error
                      ? { data: null, error: { message: options.error } }
                      : { data: options.callAt ? { call_at: options.callAt } : null, error: null },
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

describe('readMojoCallIngestHealth', () => {
  const now = new Date('2026-11-14T18:00:00.000Z')

  it('reports a successful ingest inside 24 hours as current', async () => {
    const health = await readMojoCallIngestHealth(db({
      okAt: '2026-11-14T12:00:00.000Z',
      callAt: '2026-11-14T16:00:00.000Z',
    }), now)
    expect(health).toMatchObject({
      status: 'current',
      stale: false,
      latestCallAt: '2026-11-14T16:00:00.000Z',
    })
  })

  it('reports a missing or day-old success as stale', async () => {
    await expect(readMojoCallIngestHealth(db({ okAt: null }), now)).resolves.toMatchObject({ status: 'stale', stale: true })
    await expect(readMojoCallIngestHealth(db({ okAt: '2026-11-13T17:00:00.000Z' }), now)).resolves.toMatchObject({
      status: 'stale',
      stale: true,
      ageHours: 25,
    })
  })

  it('does not claim stale when the health read itself fails', async () => {
    await expect(readMojoCallIngestHealth(db({ error: 'down' }), now)).resolves.toMatchObject({
      status: 'unknown',
      stale: false,
    })
  })
})
