import { describe, expect, it } from 'vitest'
import { evaluateTrackingHealth, summarizeFailures, type TrackingHealthSnapshot } from './tracking-health'

const healthy: TrackingHealthSnapshot = {
  now: '2026-11-22T13:43:00.000Z',
  realPageViews24h: 40,
  lastAdsSyncSuccessAt: '2026-11-22T13:30:00.000Z',
  analyticsLastOkAt: { ga4: '2026-11-22T08:17:00.000Z', ga4_events: '2026-11-22T08:17:00.000Z', gsc: '2026-11-22T08:17:00.000Z' },
  stalePendingConversions: 0,
  newDeadLetterConversions: 0,
  websiteLeadsMissingJourney: 0,
  websiteLeads14d: 3,
}

const failing = (s: TrackingHealthSnapshot) => evaluateTrackingHealth(s).filter((c) => !c.ok).map((c) => c.key)

describe('tracking health', () => {
  it('passes when everything is flowing', () => {
    expect(failing(healthy)).toEqual([])
    expect(summarizeFailures(evaluateTrackingHealth(healthy)).text).toBe('')
  })

  it('flags no visits, a stale Ads sync and a stale GA4 sync', () => {
    expect(failing({ ...healthy, realPageViews24h: 0 })).toEqual(['page_views'])
    expect(failing({ ...healthy, lastAdsSyncSuccessAt: '2026-06-13T14:40:00.000Z' })).toEqual(['google_ads_sync'])
    expect(failing({ ...healthy, lastAdsSyncSuccessAt: null })).toEqual(['google_ads_sync'])
    expect(failing({ ...healthy, analyticsLastOkAt: { ...healthy.analyticsLastOkAt, gsc: '2026-11-20T08:17:00.000Z' } })).toEqual(['analytics_gsc'])
  })

  it('flags stuck conversions and unlinked website leads', () => {
    expect(failing({ ...healthy, stalePendingConversions: 2 })).toEqual(['conversion_queue'])
    expect(failing({ ...healthy, newDeadLetterConversions: 1 })).toEqual(['conversion_queue'])
    expect(failing({ ...healthy, websiteLeadsMissingJourney: 1 })).toEqual(['journey_linking'])
  })

  it('treats zero website leads in 14 days as a warning, not a fix', () => {
    const checks = evaluateTrackingHealth({ ...healthy, websiteLeads14d: 0 })
    const summary = summarizeFailures(checks)
    expect(summary.critical).toEqual([])
    expect(summary.warnings.map((c) => c.key)).toEqual(['website_leads'])
    expect(summary.text).toMatch(/^WATCH: Website forms are producing leads/)
  })

  it('words an old sync in days', () => {
    const ads = evaluateTrackingHealth({ ...healthy, lastAdsSyncSuccessAt: '2026-06-13T14:40:00.000Z' }).find((c) => c.key === 'google_ads_sync')
    expect(ads?.detail).toBe('last successful sync 162 days ago')
  })
})
