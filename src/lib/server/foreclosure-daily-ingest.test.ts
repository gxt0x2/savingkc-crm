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
})

describe('foreclosure ingest provider gate', () => {
  it('accepts an explicit CSV body without inventing PropStream', async () => {
    const result = await resolveForeclosureIngestProvider({ csvBody: 'row_id,county\n1,jackson\n' })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.provider).toBe('csv_url')
      expect(result.source).toBe('request_body')
      expect(result.csv).toContain('row_id')
    }
  })

  it('returns not_configured for PropStream without inventing endpoints', async () => {
    vi.stubEnv('FORECLOSURE_INGEST_PROVIDER', 'propstream')
    vi.stubEnv('PROPSTREAM_API_KEY', 'test-key')
    const result = await resolveForeclosureIngestProvider()
    expect(result.status).toBe('not_configured')
    if (result.status === 'not_configured') {
      expect(result.provider).toBe('propstream')
      expect(result.reason.toLowerCase()).toContain('no first-hand propstream')
      expect(result.documentedSecrets).toContain('PROPSTREAM_API_BASE_URL')
      expect(result.missingSecrets.join(' ')).toMatch(/PROPSTREAM_API_BASE_URL/)
    }
  })

  it('documents csv_url secrets when nothing is configured', async () => {
    vi.stubEnv('FORECLOSURE_INGEST_PROVIDER', '')
    vi.stubEnv('FORECLOSURE_INGEST_CSV_URL', '')
    vi.stubEnv('PROPSTREAM_API_KEY', '')
    vi.stubEnv('PROPSTREAM_API_BASE_URL', '')
    const result = await resolveForeclosureIngestProvider()
    expect(result.status).toBe('not_configured')
    if (result.status === 'not_configured') {
      expect(result.missingSecrets).toContain('FORECLOSURE_INGEST_CSV_URL')
      expect(result.documentedSecrets).toContain('CRON_SECRET')
    }
  })
})
