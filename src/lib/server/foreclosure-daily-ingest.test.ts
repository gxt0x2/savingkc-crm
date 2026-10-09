import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  evaluateForeclosureStale,
  isChicagoWeekday,
  resetForeclosureStaleAlertDedupeForTests,
  resolveForeclosureIngestProvider,
} from '@/lib/server/foreclosure-daily-ingest'

afterEach(() => {
  resetForeclosureStaleAlertDedupeForTests()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('foreclosure daily ingest freshness', () => {
  it('marks empty tables stale on Chicago weekdays only', () => {
    const friday = new Date('2026-10-02T15:00:00-05:00') // Fri CT
    const sunday = new Date('2026-10-04T15:00:00-05:00') // Sun CT
    expect(isChicagoWeekday(friday)).toBe(true)
    expect(isChicagoWeekday(sunday)).toBe(false)
    expect(evaluateForeclosureStale({ newestCreatedAt: null, now: friday }).stale).toBe(true)
    expect(evaluateForeclosureStale({ newestCreatedAt: null, now: sunday }).stale).toBe(false)
  })

  it('marks rows older than 24h stale on weekdays and quiet on weekends', () => {
    const friday = new Date('2026-10-02T15:00:00-05:00')
    const sunday = new Date('2026-10-04T15:00:00-05:00')
    const old = new Date(friday.getTime() - 25 * 60 * 60 * 1000).toISOString()
    const fresh = new Date(friday.getTime() - 2 * 60 * 60 * 1000).toISOString()
    expect(evaluateForeclosureStale({ newestCreatedAt: old, now: friday }).stale).toBe(true)
    expect(evaluateForeclosureStale({ newestCreatedAt: fresh, now: friday }).stale).toBe(false)
    expect(evaluateForeclosureStale({ newestCreatedAt: old, now: sunday }).stale).toBe(false)
  })

  it('treats a fresh updated_at as a landing even when created_at is old', () => {
    const friday = new Date('2026-10-02T15:00:00-05:00')
    const old = new Date(friday.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const fresh = new Date(friday.getTime() - 2 * 60 * 60 * 1000).toISOString()
    expect(evaluateForeclosureStale({ newestCreatedAt: old, newestUpdatedAt: fresh, now: friday }).stale).toBe(false)
  })
})

describe('foreclosure ingest provider gate', () => {
  it('accepts an explicit CSV body without calling county sources', async () => {
    const result = await resolveForeclosureIngestProvider({ csvBody: 'row_id,county\n1,jackson\n' })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.provider).toBe('csv_url')
      expect(result.source).toBe('request_body')
      expect(result.csv).toContain('row_id')
    }
  })

  it('refuses PropStream as an ingest provider instead of inventing an API', async () => {
    vi.stubEnv('FORECLOSURE_INGEST_PROVIDER', 'propstream')
    const result = await resolveForeclosureIngestProvider()
    expect(result.status).toBe('not_configured')
    if (result.status === 'not_configured') {
      expect(result.provider).toBe('propstream')
      expect(result.reason.toLowerCase()).toContain('not a foreclosure ingest provider')
      expect(result.reason.toLowerCase()).toContain('will not invent')
      expect(result.missingSecrets).toEqual([])
    }
  })

  it('defaults to county_public and records source errors without a CSV upload', async () => {
    vi.stubEnv('FORECLOSURE_INGEST_PROVIDER', '')
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const result = await resolveForeclosureIngestProvider()
    expect(result.provider).toBe('county_public')
    expect(result.status === 'error' || result.status === 'not_configured').toBe(true)
    const notes = result.sourceNotes?.join(' ') || ''
    expect(notes.toLowerCase()).toContain('mopublicnotices')
    expect(notes.toLowerCase()).toContain('computeruse')
  })
})
