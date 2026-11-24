import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))

import {
  activeForeclosureCounties,
  evaluateForeclosureCounties,
  evaluateForeclosureStale,
  foreclosureCountyProviderSignals,
  isChicagoWeekday,
  resetForeclosureStaleAlertDedupeForTests,
  resolveForeclosureIngestProvider,
  sendForeclosureStaleAlert,
  type ForeclosureCountyActivity,
} from '@/lib/server/foreclosure-daily-ingest'

const FRIDAY = new Date('2026-10-02T15:00:00-05:00')
const SUNDAY = new Date('2026-10-04T15:00:00-05:00')

function hoursBefore(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()
}

function county(overrides: Partial<ForeclosureCountyActivity> & Pick<ForeclosureCountyActivity, 'county' | 'state'>): ForeclosureCountyActivity {
  return {
    paused: false,
    newestCreatedAt: null,
    newestUpdatedAt: null,
    watermarkAt: null,
    lastError: null,
    salesCount: null,
    ...overrides,
  }
}

afterEach(() => {
  resetForeclosureStaleAlertDedupeForTests()
  mocks.send.mockReset()
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

describe('foreclosure county stale alert', () => {
  it('names only Johnson when that county is dark and Jackson is fresh', async () => {
    const fresh = hoursBefore(FRIDAY, 2)
    const report = evaluateForeclosureCounties({
      now: FRIDAY,
      counties: [
        county({ county: 'jackson', state: 'MO', newestCreatedAt: fresh, salesCount: 8 }),
        county({
          county: 'johnson',
          state: 'KS',
          newestCreatedAt: fresh,
          salesCount: 0,
          lastError: 'joco HTTP 404',
        }),
      ],
    })
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'alerts@example.com')
    mocks.send.mockResolvedValue({ data: { id: 'email-1' } })

    const alert = await sendForeclosureStaleAlert({
      counties: report.counties,
      notes: [],
      chicagoDate: report.chicagoDate,
      chicagoWeekday: report.chicagoWeekday,
    })

    expect(alert.sent).toBe(true)
    expect(alert.warranted).toBe(true)
    expect(alert.counties.filter((item) => item.stale).map((item) => item.county)).toEqual(['johnson'])
    expect(mocks.send).toHaveBeenCalledTimes(1)
    const message = mocks.send.mock.calls[0][0] as { subject: string; text: string }
    expect(message.subject).toBe('Foreclosure portal stale — Johnson KS')
    expect(message.text).toContain('Johnson KS')
    expect(message.text).toContain('joco HTTP 404')
    expect(message.text).not.toMatch(/Jackson/)
  })

  it('sends nothing when every county control is paused', async () => {
    const old = hoursBefore(FRIDAY, 48)
    const report = evaluateForeclosureCounties({
      now: FRIDAY,
      counties: [
        county({ county: 'jackson', state: 'MO', paused: true, newestCreatedAt: old }),
        county({ county: 'johnson', state: 'KS', paused: true, newestCreatedAt: old, lastError: 'joco HTTP 404', salesCount: 0 }),
      ],
    })
    const alert = await sendForeclosureStaleAlert({
      counties: report.counties,
      notes: [],
      chicagoDate: report.chicagoDate,
      chicagoWeekday: report.chicagoWeekday,
    })
    expect(report.warranted).toBe(false)
    expect(report.counties.every((item) => item.stale === false)).toBe(true)
    expect(alert).toMatchObject({ sent: false, skippedReason: 'all_paused', warranted: false, counties: [] })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('sends nothing on a Chicago weekend', async () => {
    const report = evaluateForeclosureCounties({
      now: SUNDAY,
      counties: [
        county({ county: 'johnson', state: 'KS', newestCreatedAt: hoursBefore(SUNDAY, 72), lastError: 'joco HTTP 404', salesCount: 0 }),
      ],
    })
    const alert = await sendForeclosureStaleAlert({
      counties: report.counties,
      notes: [],
      chicagoDate: report.chicagoDate,
      chicagoWeekday: report.chicagoWeekday,
    })
    expect(report.counties[0]?.stale).toBe(false)
    expect(alert.sent).toBe(false)
    expect(alert.skippedReason).toBe('weekend')
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('reports stale counties when Resend is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('RESEND_FROM_EMAIL', '')
    const report = evaluateForeclosureCounties({
      now: FRIDAY,
      counties: [
        county({ county: 'jackson', state: 'MO', newestCreatedAt: hoursBefore(FRIDAY, 2), salesCount: 4 }),
        county({ county: 'johnson', state: 'KS', newestCreatedAt: hoursBefore(FRIDAY, 30), salesCount: 0, lastError: 'joco returned 0 sales' }),
      ],
    })
    const alert = await sendForeclosureStaleAlert({
      counties: report.counties,
      notes: [],
      chicagoDate: report.chicagoDate,
      chicagoWeekday: report.chicagoWeekday,
    })
    expect(alert.sent).toBe(false)
    expect(alert.skippedReason).toBe('resend_not_configured')
    expect(alert.counties.filter((item) => item.stale).map((item) => `${item.county}:${item.state}`)).toEqual(['johnson:KS'])
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('treats 0 sales as dark even when that county created a row recently', () => {
    const fresh = hoursBefore(FRIDAY, 2)
    const report = evaluateForeclosureCounties({
      now: FRIDAY,
      counties: [
        county({ county: 'jackson', state: 'MO', newestCreatedAt: fresh, salesCount: 3 }),
        county({ county: 'johnson', state: 'KS', newestCreatedAt: fresh, salesCount: 0, lastError: 'joco returned 0 sales' }),
      ],
    })
    expect(report.counties.find((item) => item.county === 'johnson')).toMatchObject({ stale: true, dark: true })
    expect(report.counties.find((item) => item.county === 'jackson')).toMatchObject({ stale: false, dark: false })
  })

  it('does not let a fresh sibling watermark hide an old county', () => {
    const report = evaluateForeclosureCounties({
      now: FRIDAY,
      counties: [
        county({ county: 'jackson', state: 'MO', newestCreatedAt: hoursBefore(FRIDAY, 2), salesCount: 3 }),
        county({
          county: 'johnson',
          state: 'KS',
          newestCreatedAt: hoursBefore(FRIDAY, 48),
          watermarkAt: hoursBefore(FRIDAY, 1),
          salesCount: null,
        }),
      ],
    })
    expect(report.counties.filter((item) => item.stale).map((item) => item.county)).toEqual(['johnson'])
  })

  it('uses a fresh updated_at as a landing and a watermark only when no prospect timestamp exists', () => {
    const fresh = hoursBefore(FRIDAY, 2)
    const old = hoursBefore(FRIDAY, 48)
    const landed = evaluateForeclosureCounties({
      now: FRIDAY,
      counties: [county({ county: 'johnson', state: 'KS', newestCreatedAt: old, newestUpdatedAt: fresh })],
    })
    expect(landed.counties[0]?.stale).toBe(false)
    const watermarkOnly = evaluateForeclosureCounties({
      now: FRIDAY,
      counties: [county({ county: 'clay', state: 'MO', newestCreatedAt: null, watermarkAt: fresh })],
    })
    expect(watermarkOnly.counties[0]?.stale).toBe(false)
  })

  it('maps a JoCo 404 and a zero-sale pull onto Johnson only', () => {
    const dark = foreclosureCountyProviderSignals({
      errors: ['joco HTTP 404'],
      stats: { jocoSales: 0, southlawJackson: 6 },
    })
    expect(dark.find((item) => item.county === 'johnson')).toMatchObject({
      state: 'KS',
      salesCount: 0,
      lastError: 'joco HTTP 404',
    })
    expect(dark.find((item) => item.county === 'jackson')).toMatchObject({ lastError: null, salesCount: 6 })

    const empty = foreclosureCountyProviderSignals({
      errors: [],
      stats: { jocoSales: 0, southlawJackson: 2 },
    })
    expect(empty.find((item) => item.county === 'johnson')?.lastError).toBe('joco returned 0 sales')
  })

  it('ignores paused controls when choosing who can alert', () => {
    expect(activeForeclosureCounties([
      { county: 'Johnson', noticeType: 'sheriff_sale', paused: true, updatedSince: '2026-11-01T00:00:00.000Z' },
      { county: 'jackson', noticeType: 'nod', paused: false, updatedSince: '2026-11-20T00:00:00.000Z' },
      { county: 'jackson', noticeType: 'lis_pendens', paused: false, updatedSince: '2026-11-23T00:00:00.000Z' },
    ])).toEqual([
      { county: 'jackson', state: 'MO', watermarkAt: '2026-11-23T00:00:00.000Z' },
    ])
  })
})
