import { describe, expect, it, vi } from 'vitest'
import { requeueCutoffIso, requeueGoogleAdsDeadLetters } from './requeue-after-reconnect'

function fakeDb(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = []
  const chain: Record<string, unknown> = {}
  for (const name of ['update', 'eq', 'gte', 'select']) {
    chain[name] = vi.fn((...args: unknown[]) => { calls.push([name, ...args]); return name === 'select' ? Promise.resolve(result) : chain })
  }
  const db = { from: vi.fn((table: string) => { calls.push(['from', table]); return chain }) }
  return { db, calls }
}

describe('requeue after Google Ads reconnect', () => {
  const now = new Date('2026-11-21T12:00:00Z')

  it('only requeues Google Ads dead letters inside the 90-day click window', async () => {
    const { db, calls } = fakeDb({ data: [{ id: 'a' }, { id: 'b' }], error: null })
    await expect(requeueGoogleAdsDeadLetters(db as never, now)).resolves.toBe(2)
    expect(calls).toContainEqual(['from', 'ppc_conversion_outbox'])
    expect(calls).toContainEqual(['eq', 'status', 'dead_letter'])
    expect(calls).toContainEqual(['eq', 'destination', 'google_ads'])
    expect(calls).toContainEqual(['gte', 'event_time', '2026-08-23T12:00:00.000Z'])
    expect(requeueCutoffIso(now)).toBe('2026-08-23T12:00:00.000Z')
  })

  it('returns 0 and does not throw on a database error', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'down' } })
    await expect(requeueGoogleAdsDeadLetters(db as never, now)).resolves.toBe(0)
  })
})
