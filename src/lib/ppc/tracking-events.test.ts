import { describe, expect, it } from 'vitest'
import { buildWebsiteConversionReport, type AnalyticsSyncRun } from '@/lib/marketing/website-conversion'
import {
  buildPpcTrackingEventRow,
  storedFirstPartyEventCampaign,
  unprovenSearch2026CampaignNote,
  unprovenStoredSearchCampaign,
} from './tracking-events'

describe('ppc tracking event rows', () => {
  it('derives OpenAI Ads traffic source from ChatGPT referrer without a Google click id', () => {
    const row = buildPpcTrackingEventRow({
      eventId: 'skc_ppc_visit_started_openai_referrer',
      eventName: 'ppc_visit_started',
      sessionId: 'session-openai',
      visitorId: 'visitor-openai',
      pagePath: '/ppc',
      pageLocation: 'https://savingkc.com/ppc',
      pageReferrer: 'https://chatgpt.com/c/seller-search',
      attribution: {
        landingUrl: 'https://savingkc.com/ppc',
        referrer: 'https://chatgpt.com/c/seller-search',
      },
    })

    expect(row).toMatchObject({
      event_name: 'ppc_visit_started',
      traffic_source: 'openai_ads',
      campaign: null,
      page_location: 'https://savingkc.com/ppc',
      page_referrer: 'https://chatgpt.com/c/seller-search',
      gclid: null,
      gbraid: null,
      wbraid: null,
    })
  })

  it('stores the first-party OpenAI click id in attribution payloads', () => {
    const row = buildPpcTrackingEventRow({
      eventId: 'skc_ppc_visit_started_openai_click',
      eventName: 'ppc_visit_started',
      sessionId: 'session-openai',
      visitorId: 'visitor-openai',
      pagePath: '/ppc',
      pageLocation: 'https://savingkc.com/ppc?utm_source=chatgpt',
      attribution: {
        utm_source: 'chatgpt',
        skc_openai_click_id: 'skc_openai_abc',
        landingUrl: 'https://savingkc.com/ppc?utm_source=chatgpt',
      },
    })

    expect(row).toMatchObject({
      traffic_source: 'openai_ads',
      campaign: null,
      utm_source: 'chatgpt',
      gclid: null,
      gbraid: null,
      wbraid: null,
      payload: {
        attribution: expect.objectContaining({
          skc_openai_click_id: 'skc_openai_abc',
        }),
      },
    })
  })
})

describe('sitewide journey traffic sources (Item 1)', () => {
  const base = { eventId: 'sid-1:page_view:1', eventName: 'page_view', sessionId: 'sid-1' }

  it('does not label an organic or ChatGPT visitor on the main site as Google Ads', () => {
    expect(buildPpcTrackingEventRow({ ...base, pagePath: '/probate/', pageReferrer: 'https://www.google.com/', attribution: {} }).traffic_source).toBe('organic_search')
    expect(buildPpcTrackingEventRow({ ...base, pagePath: '/', pageReferrer: 'https://chatgpt.com/', attribution: {} }).traffic_source).toBe('ai_referral')
    expect(buildPpcTrackingEventRow({ ...base, pagePath: '/', attribution: { utm_source: 'chatgpt.com' } }).traffic_source).toBe('ai_referral')
    expect(buildPpcTrackingEventRow({ ...base, pagePath: '/', attribution: {} }).traffic_source).toBe('direct')
    expect(buildPpcTrackingEventRow({ ...base, pagePath: '/', trafficSource: 'non_paid', pageReferrer: 'https://www.facebook.com/', attribution: {} }).traffic_source).toBe('social')
  })

  it('keeps paid when there is paid evidence', () => {
    expect(buildPpcTrackingEventRow({ ...base, pagePath: '/', attribution: { gclid: 'Cj0abc' } }).traffic_source).toBe('google_ads')
    expect(buildPpcTrackingEventRow({ ...base, pagePath: '/', attribution: { utm_source: 'google', utm_medium: 'cpc' } }).traffic_source).toBe('google_ads')
    expect(buildPpcTrackingEventRow({ ...base, pagePath: '/', trafficSource: 'google_ads', attribution: {} }).traffic_source).toBe('google_ads')
  })

  it('keeps the site journey label and flags test events', () => {
    const row = buildPpcTrackingEventRow({ ...base, eventName: 'cta_click', trafficSource: 'ai_referral', isTest: true, attribution: {} })
    expect(row).toMatchObject({ traffic_source: 'ai_referral', campaign: null, is_test: true, event_category: 'web' })
    expect(buildPpcTrackingEventRow({ ...base, eventName: 'form_step_completed', formStep: 2, attribution: {} })).toMatchObject({ event_category: 'form', form_step: 2, campaign: null })
  })
})

describe('stored first-party event campaign', () => {
  const base = { eventId: 'sid-direct:page_view:1', eventName: 'page_view', sessionId: 'sid-direct', pagePath: '/' }

  it('leaves direct traffic null even when a caller sends the Search 2026 default', () => {
    const direct = buildPpcTrackingEventRow({
      ...base,
      campaign: 'Search 2026',
      attribution: {},
    })
    const lander = buildPpcTrackingEventRow({
      ...base,
      eventId: 'sid-direct:page_view:lander',
      campaign: 'Search 2026',
      pagePath: '/ppc',
      pageLocation: 'https://savingkc.com/ppc',
      attribution: { landingUrl: 'https://savingkc.com/ppc' },
    })

    expect(direct).toMatchObject({ campaign: null, utm_campaign: null, traffic_source: 'direct' })
    expect(lander.campaign).toBeNull()
    expect(lander.utm_campaign).toBeNull()
  })

  it('stores utm_campaign when it is present, without requiring a click id', () => {
    const row = buildPpcTrackingEventRow({
      ...base,
      campaign: 'Search 2026',
      attribution: { utm_campaign: 'Neighborhood postcard' },
    })

    expect(row).toMatchObject({ campaign: 'Neighborhood postcard', utm_campaign: 'Neighborhood postcard' })
  })

  it('stores the paid campaign name only with click-id or paid-medium evidence', () => {
    expect(buildPpcTrackingEventRow({ ...base, attribution: { gclid: 'Cj0abc' } }).campaign).toBe('Search 2026')
    expect(buildPpcTrackingEventRow({ ...base, attribution: { gbraid: 'gbraid-1' } }).campaign).toBe('Search 2026')
    expect(buildPpcTrackingEventRow({ ...base, attribution: { wbraid: 'wbraid-1' } }).campaign).toBe('Search 2026')
    expect(buildPpcTrackingEventRow({ ...base, attribution: { msclkid: 'ms-click' } }).campaign).toBe('Search 2026')
    expect(buildPpcTrackingEventRow({ ...base, attribution: { utm_medium: 'CPC' } }).campaign).toBe('Search 2026')
    expect(buildPpcTrackingEventRow({ ...base, attribution: { utm_medium: 'ppc' } }).campaign).toBe('Search 2026')
    expect(buildPpcTrackingEventRow({ ...base, attribution: { utm_medium: 'paid' } }).campaign).toBe('Search 2026')
    expect(buildPpcTrackingEventRow({
      ...base,
      pagePath: '/ppc-tax',
      pageLocation: 'https://savingkc.com/ppc-tax?gclid=tax-click',
      attribution: { gclid: 'tax-click' },
    }).campaign).toBe('Search - Property Tax')
    expect(buildPpcTrackingEventRow({
      ...base,
      campaign: 'Named paid campaign',
      attribution: { gclid: 'Cj0abc' },
    }).campaign).toBe('Named paid campaign')
    expect(storedFirstPartyEventCampaign({
      payload: { gclid: 'payload-click' },
    })).toBe('Search 2026')
  })

  it('does not treat a paid-looking medium outside cpc/ppc/paid, or an OpenAI click id, as campaign evidence', () => {
    expect(buildPpcTrackingEventRow({ ...base, attribution: { utm_medium: 'sem' } }).campaign).toBeNull()
    expect(buildPpcTrackingEventRow({ ...base, attribution: { utm_medium: 'organic' } }).campaign).toBeNull()
    expect(buildPpcTrackingEventRow({ ...base, attribution: { gclid: '   ' } }).campaign).toBeNull()
    expect(buildPpcTrackingEventRow({
      ...base,
      pagePath: '/ppc',
      attribution: { skc_openai_click_id: 'skc_openai_abc' },
    }).campaign).toBeNull()
  })

  it('stores the website is_test flag and the funnel summary already skips those rows', () => {
    const flagged = buildPpcTrackingEventRow({ ...base, is_test: true, attribution: {} })
    const payloadFlag = buildPpcTrackingEventRow({ ...base, eventId: 'sid-direct:page_view:payload', payload: { is_test: 'true' }, attribution: {} })
    const live = buildPpcTrackingEventRow({ ...base, eventId: 'sid-direct:page_view:live', attribution: {} })

    expect(flagged.is_test).toBe(true)
    expect(payloadFlag.is_test).toBe(true)
    expect(live.is_test).toBe(false)

    const covered: AnalyticsSyncRun[] = []
    const report = buildWebsiteConversionReport({
      range: 'day',
      now: new Date('2026-10-25T15:00:00.000Z'),
      syncRuns: covered,
      ga4Rows: [],
      gscRows: [],
      leads: [],
      events: [
        { event_name: 'page_view', event_time: '2026-10-24T15:00:00.000Z', session_id: 'sid-direct', is_test: flagged.is_test },
        { event_name: 'page_view', event_time: '2026-10-24T15:01:00.000Z', session_id: 'sid-direct', is_test: live.is_test },
      ],
    })

    expect(report.funnel).toMatchObject({ landingEvents: 0, laterEvents: 1 })
  })
})

describe('historical Search 2026 rows', () => {
  it('notes rows the old writer filled in and leaves proven paid rows alone', () => {
    const rows = [
      { campaign: 'Search 2026', utm_campaign: null, utm_medium: null, gclid: null, traffic_source: 'direct' },
      { campaign: 'Search 2026', utm_campaign: 'Search 2026', gclid: null },
      { campaign: 'Search 2026', gclid: 'Cj0abc' },
      { campaign: 'Search 2026', utm_medium: 'cpc' },
      { campaign: 'Search 2026', payload: { attribution: { msclkid: 'ms-click' } } },
      { campaign: 'Neighborhood postcard', utm_campaign: 'Neighborhood postcard' },
      { campaign: null, traffic_source: 'direct' },
    ]

    expect(rows.filter(unprovenStoredSearchCampaign)).toHaveLength(1)
    expect(unprovenSearch2026CampaignNote(rows)).toMatchObject({
      unprovenSearch2026: 1,
      note: expect.stringContaining('scripts/backfill-unproven-search-2026-campaigns.mts'),
    })
    expect(unprovenSearch2026CampaignNote(rows).note).toContain('does not change them')
  })
})
