import { describe, expect, it } from 'vitest'

import {
  bucketSessionSource,
  buildWebsiteConversionReport,
  chicagoMidnightUtc,
  chicagoRangeInstants,
  lastCompleteAnalyticsDay,
  normalizeLandingPath,
  rangeWindow,
  type AnalyticsSyncRun,
} from './website-conversion'

const NOW = new Date('2026-10-25T15:00:00.000Z')

const covered: AnalyticsSyncRun[] = [
  { source: 'ga4', mode: 'nightly', started_at: '2026-10-25T08:17:00.000Z', finished_at: '2026-10-25T08:17:20.000Z', since_date: '2026-10-22', until_date: '2026-10-24', status: 'ok', rows_upserted: 30, error: null },
  { source: 'gsc', mode: 'nightly', started_at: '2026-10-25T08:17:00.000Z', finished_at: '2026-10-25T08:17:40.000Z', since_date: '2026-10-22', until_date: '2026-10-24', status: 'ok', rows_upserted: 80, error: null },
]

describe('website conversion windows', () => {
  it('anchors ranges to yesterday in Chicago, including the daylight-saving offset', () => {
    expect(lastCompleteAnalyticsDay(NOW)).toBe('2026-10-24')
    expect(lastCompleteAnalyticsDay(new Date('2026-10-25T04:30:00.000Z'))).toBe('2026-10-23')
    expect(lastCompleteAnalyticsDay(new Date('2026-01-15T12:00:00.000Z'))).toBe('2026-01-14')
    expect(chicagoMidnightUtc('2026-10-24').toISOString()).toBe('2026-10-24T05:00:00.000Z')
    expect(chicagoMidnightUtc('2026-01-15').toISOString()).toBe('2026-01-15T06:00:00.000Z')
    expect(chicagoRangeInstants('2026-10-24', '2026-10-24')).toEqual({
      startIso: '2026-10-24T05:00:00.000Z',
      endIso: '2026-10-25T05:00:00.000Z',
    })
  })

  it('builds day, week, month, quarter, and year windows through the anchor', () => {
    expect(rangeWindow('day', '2026-10-24')).toMatchObject({ start: '2026-10-24', end: '2026-10-24', days: 1 })
    expect(rangeWindow('week', '2026-10-24')).toMatchObject({ start: '2026-10-19', end: '2026-10-24', days: 6 })
    expect(rangeWindow('month', '2026-10-24')).toMatchObject({ start: '2026-10-01', end: '2026-10-24' })
    expect(rangeWindow('quarter', '2026-10-24')).toMatchObject({ start: '2026-10-01', end: '2026-10-24' })
    expect(rangeWindow('year', '2026-10-24')).toMatchObject({ start: '2026-01-01', end: '2026-10-24' })
    expect(rangeWindow('quarter', '2026-02-02').start).toBe('2026-01-01')
  })
})

describe('website conversion aggregation', () => {
  it('keeps the six source buckets and merges landing paths without inventing a seventh channel', () => {
    expect(bucketSessionSource('chatgpt.com / ai-assistant')).toBe('chatgpt')
    expect(bucketSessionSource('Google / Organic')).toBe('google_organic')
    expect(bucketSessionSource('bing / organic')).toBe('bing_organic')
    expect(bucketSessionSource('google / cpc')).toBe('google_cpc')
    expect(bucketSessionSource('(direct) / (none)')).toBe('direct')
    expect(bucketSessionSource('m.facebook.com / referral')).toBe('other')
    expect(normalizeLandingPath('https://www.savingkc.com/about-us/')).toBe('/about-us')
    expect(normalizeLandingPath('https://savingkc.com/')).toBe('/')
    expect(normalizeLandingPath('')).toBe('(not set)')

    const report = buildWebsiteConversionReport({
      range: 'day',
      now: NOW,
      syncRuns: covered,
      ga4Rows: [
        { date: '2026-10-24', landing_page: '/', session_source_medium: 'chatgpt.com / ai-assistant', sessions: 3, engaged_sessions: 3 },
        { date: '2026-10-24', landing_page: '/call', session_source_medium: '(direct) / (none)', sessions: 12, engaged_sessions: 1 },
        { date: '2026-10-24', landing_page: 'https://www.savingkc.com/about-us/', session_source_medium: 'google / organic', sessions: 4, engaged_sessions: 0 },
        { date: '2026-10-24', landing_page: '/research', session_source_medium: 'm.facebook.com / referral', sessions: 2, engaged_sessions: 2 },
      ],
      gscRows: [
        { date: '2026-10-24', page: 'https://savingkc.com/', clicks: 2, impressions: 10, position: 4 },
        { date: '2026-10-24', page: 'https://www.savingkc.com/', clicks: 1, impressions: 30, position: 8 },
        { date: '2026-10-24', page: 'https://savingkc.com/call', clicks: 0, impressions: 5, position: 12 },
      ],
      leads: [
        { source: 'website_form', created_at: '2026-10-24T18:00:00.000Z' },
        { source: 'google_ads_phone', created_at: '2026-10-24T18:00:00.000Z' },
        { source: 'ppc-landing', created_at: '2026-10-24T18:00:00.000Z' },
      ],
      events: [
        { event_name: 'ppc_landing_request', event_time: '2026-10-24T15:00:00.000Z', session_id: 's1', is_test: false },
        { event_name: 'ppc_visit_started', event_time: '2026-10-24T15:01:00.000Z', session_id: null, is_test: false },
        { event_name: 'skc_phone_number_selected', event_time: '2026-10-24T15:02:00.000Z', session_id: 's1', is_test: false },
        { event_name: 'phone_click', event_time: '2026-10-24T15:03:00.000Z', session_id: 's2', is_test: false },
        { event_name: 'legacy_attribution_backfill', event_time: '2026-10-24T15:04:00.000Z', session_id: 's9', is_test: false },
        { event_name: 'ppc_landing_request', event_time: '2026-10-24T15:05:00.000Z', session_id: 'test', is_test: true },
      ],
    })

    expect(report.anchorDate).toBe('2026-10-24')
    expect(report.ga4).toMatchObject({ status: 'ready', sessions: 21, engagedSessions: 6 })
    expect(report.ga4.engagementRate).toBeCloseTo(6 / 21)
    expect(report.sources.map((source) => [source.key, source.sessions])).toEqual([
      ['chatgpt', 3],
      ['google_organic', 4],
      ['bing_organic', 0],
      ['google_cpc', 0],
      ['direct', 12],
      ['other', 2],
    ])
    expect(report.gsc).toMatchObject({ status: 'ready', clicks: 3, impressions: 45 })
    expect(report.gsc.ctr).toBeCloseTo(3 / 45)
    expect(report.gsc.averagePosition).toBeCloseTo((4 * 10 + 8 * 30 + 12 * 5) / 45)
    expect(report.leads).toMatchObject({ websiteForm: 1, googleAdsPhone: 1, googleAdsTaxPhone: 0 })
    expect(report.rates.sessionToForm).toBeCloseTo(1 / 21)
    expect(report.rates.engagedToForm).toBeCloseTo(1 / 6)
    expect(report.funnel).toMatchObject({
      landingEvents: 2,
      laterEvents: 2,
      landingSessions: 1,
      sessionsWithLaterEvent: 1,
      unsessionedLandingEvents: 1,
    })
    expect(report.callIntent).toMatchObject({ telClicks: 2, googleAdsPhoneLeads: 1 })
    expect(report.landingPagesBySessions[0]?.path).toBe('/call')
    expect(report.suggestions.map((suggestion) => suggestion.id)).toEqual(['call-bounce', 'about-form-below-fold'])
    expect(report.chart).toHaveLength(1)
  })

  it('fires the low-engagement and zero-form rules only past their floors', () => {
    const rows = [
      { date: '2026-10-24', landing_page: '/research', session_source_medium: 'google / organic', sessions: 10, engaged_sessions: 1 },
      { date: '2026-10-24', landing_page: '/contact', session_source_medium: 'bing / organic', sessions: 11, engaged_sessions: 1 },
    ]
    const fired = buildWebsiteConversionReport({
      range: 'day',
      now: NOW,
      syncRuns: covered,
      ga4Rows: rows,
      gscRows: [],
      leads: [],
      events: [],
    })
    expect(fired.ga4.sessions).toBe(21)
    expect(fired.suggestions.map((suggestion) => suggestion.id)).toEqual([
      'zero-form-cvr',
      'low-engagement:/contact',
      'low-engagement:/research',
    ])

    const underTheFloor = buildWebsiteConversionReport({
      range: 'day',
      now: NOW,
      syncRuns: covered,
      ga4Rows: [{ date: '2026-10-24', landing_page: '/research', session_source_medium: 'google / organic', sessions: 20, engaged_sessions: 4 }],
      gscRows: [],
      leads: [],
      events: [],
    })
    expect(underTheFloor.ga4.engagementRate).toBeCloseTo(0.2)
    expect(underTheFloor.suggestions).toEqual([])
  })

  it('leaves metrics blank when the sync has not covered the range', () => {
    const report = buildWebsiteConversionReport({
      range: 'day',
      now: NOW,
      syncRuns: [],
      ga4Rows: [],
      gscRows: null,
      leads: null,
      events: null,
    })
    expect(report.ga4.status).toBe('missing')
    expect(report.gsc.status).toBe('missing')
    expect(report.ga4.sessions).toBeNull()
    expect(report.gsc.clicks).toBeNull()
    expect(report.rates).toEqual({ sessionToForm: null, engagedToForm: null })
    expect(report.sources).toEqual([])
    expect(report.suggestions).toEqual([])
    expect(report.series[0]).toMatchObject({ sessions: null, clicks: null })
  })

  it('treats a covered day with no stored rows as a real zero', () => {
    const report = buildWebsiteConversionReport({
      range: 'day',
      now: NOW,
      syncRuns: covered,
      ga4Rows: [],
      gscRows: [],
      leads: [],
      events: [],
    })
    expect(report.ga4).toMatchObject({ status: 'ready', sessions: 0, engagementRate: null })
    expect(report.gsc).toMatchObject({ status: 'ready', clicks: 0, impressions: 0, ctr: null })
    expect(report.series[0]).toMatchObject({ sessions: 0, clicks: 0 })
    expect(report.rates.sessionToForm).toBeNull()
  })

  it('rolls a year into months and does not average a stored CTR', () => {
    const report = buildWebsiteConversionReport({
      range: 'year',
      now: NOW,
      syncRuns: covered,
      ga4Rows: [
        { date: '2026-01-03', landing_page: '/', session_source_medium: 'google / cpc', sessions: 5, engaged_sessions: 4 },
        { date: '2026-10-24', landing_page: '/', session_source_medium: 'direct / none', sessions: 2, engaged_sessions: 1 },
      ],
      gscRows: [
        { date: '2026-01-03', page: 'https://savingkc.com/', clicks: 1, impressions: 4, position: 2 },
      ],
      leads: [],
      events: [],
    })
    expect(report.window.start).toBe('2026-01-01')
    expect(report.sources.find((source) => source.key === 'google_cpc')?.sessions).toBe(5)
    expect(report.sources.find((source) => source.key === 'direct')?.sessions).toBe(2)
    expect(report.chart.find((point) => point.label === 'Jan')).toMatchObject({ sessions: 5, clicks: 1 })
    expect(report.chart.find((point) => point.label === 'Oct')).toMatchObject({ sessions: 2, clicks: 0 })
    expect(report.gsc.averagePosition).toBe(2)
  })
})
