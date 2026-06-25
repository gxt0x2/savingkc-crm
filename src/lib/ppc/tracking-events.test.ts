import { describe, expect, it } from 'vitest'
import { buildPpcTrackingEventRow } from './tracking-events'

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
