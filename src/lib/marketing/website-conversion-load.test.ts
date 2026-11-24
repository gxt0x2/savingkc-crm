import { describe, expect, it } from 'vitest'

import { isMissingRelation, loadWebsiteConversionReport, WebsiteConversionReadError } from './website-conversion-load'

function builder(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const query = {
    select: () => query,
    gte: () => query,
    lte: () => query,
    lt: () => query,
    in: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    range: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  }
  return query
}

describe('website conversion loader', () => {
  it('recognizes a missing warehouse table', () => {
    expect(isMissingRelation({ code: 'PGRST205', message: 'schema cache' })).toBe(true)
    expect(isMissingRelation({ code: '42P01', message: 'relation does not exist' })).toBe(true)
    expect(isMissingRelation({ message: 'permission denied' })).toBe(false)
  })

  it('returns an empty board when the analytics tables are absent', async () => {
    const missing = { data: null, error: { code: 'PGRST205', message: 'Could not find the table in the schema cache' } }
    const db = { from: () => builder(missing) }
    const report = await loadWebsiteConversionReport(db as never, 'week', new Date('2026-10-25T15:00:00.000Z'))
    expect(report.range).toBe('week')
    expect(report.ga4.status).toBe('missing')
    expect(report.gsc.status).toBe('missing')
    expect(report.leads.status).toBe('missing')
    expect(report.ga4.sessions).toBeNull()
  })

  it('stops when a read fails for a reason other than a missing table', async () => {
    const failed = { data: null, error: { code: '42501', message: 'permission denied for table ga4_landing_daily' } }
    const db = { from: () => builder(failed) }
    await expect(loadWebsiteConversionReport(db as never, 'day', new Date('2026-10-25T15:00:00.000Z'))).rejects.toBeInstanceOf(WebsiteConversionReadError)
  })
})
