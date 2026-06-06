import { describe, expect, it } from 'vitest'
import { buildTrafficQualityReport, type TrafficQualityTrackingRow } from './traffic-quality'

function row(overrides: Partial<TrafficQualityTrackingRow>): TrafficQualityTrackingRow {
  return {
    id: overrides.event_id ?? overrides.id ?? 'event',
    event_id: overrides.event_id ?? overrides.id ?? 'event',
    event_name: overrides.event_name ?? 'ppc_landing_request',
    event_category: overrides.event_category ?? 'visit',
    event_time: overrides.event_time ?? '2026-06-06T14:00:00.000Z',
    session_id: overrides.session_id ?? null,
    visitor_id: overrides.visitor_id ?? null,
    lead_id: overrides.lead_id ?? null,
    page_path: overrides.page_path ?? '/ppc',
    page_location: overrides.page_location ?? 'https://savingkc.com/ppc',
    page_referrer: overrides.page_referrer ?? null,
    traffic_source: overrides.traffic_source ?? null,
    campaign: overrides.campaign ?? null,
    utm_source: overrides.utm_source ?? null,
    utm_medium: overrides.utm_medium ?? null,
    utm_campaign: overrides.utm_campaign ?? null,
    utm_term: overrides.utm_term ?? null,
    utm_content: overrides.utm_content ?? null,
    gclid: overrides.gclid ?? null,
    gbraid: overrides.gbraid ?? null,
    wbraid: overrides.wbraid ?? null,
    form_step: overrides.form_step ?? null,
    form_status: overrides.form_status ?? null,
    phone_number: overrides.phone_number ?? null,
    payload: overrides.payload ?? null,
    created_at: overrides.created_at ?? overrides.event_time ?? '2026-06-06T14:00:00.000Z',
  }
}

function device(ipHash: string, uaHash: string, type = 'desktop') {
  return {
    device: {
      ip_hash: ipHash,
      user_agent_hash: uaHash,
      device_platform: 'macOS',
      device_type: type,
    },
  }
}

describe('traffic quality report', () => {
  it('keeps converted Google Ads sessions healthy when engagement is present', () => {
    const report = buildTrafficQualityReport([
      row({
        event_id: 'google-server',
        event_name: 'ppc_landing_request',
        event_time: '2026-06-06T14:00:00.000Z',
        traffic_source: 'google_ads',
        campaign: 'Search 2026',
        gclid: 'gclid-good',
        payload: { ...device('ip-good', 'ua-good'), server_side: true, attribution: { gclid: 'gclid-good' } },
      }),
      row({
        event_id: 'google-client',
        event_name: 'ppc_visit_started',
        event_time: '2026-06-06T14:00:03.000Z',
        traffic_source: 'google_ads',
        campaign: 'Search 2026',
        gclid: 'gclid-good',
        payload: { ...device('ip-good', 'ua-good'), attribution: { gclid: 'gclid-good' } },
      }),
      row({
        event_id: 'google-cta',
        event_name: 'cta_click',
        event_time: '2026-06-06T14:00:18.000Z',
        traffic_source: 'google_ads',
        campaign: 'Search 2026',
        gclid: 'gclid-good',
        payload: { ...device('ip-good', 'ua-good'), attribution: { gclid: 'gclid-good' } },
      }),
      row({
        event_id: 'google-submit',
        event_name: 'lead_submitted',
        event_time: '2026-06-06T14:01:02.000Z',
        traffic_source: 'google_ads',
        campaign: 'Search 2026',
        gclid: 'gclid-good',
        lead_id: '11111111-1111-4111-8111-111111111111',
        form_step: 4,
        form_status: 'submitted',
        payload: { ...device('ip-good', 'ua-good'), attribution: { gclid: 'gclid-good' } },
      }),
    ], { now: '2026-06-06T14:02:00.000Z' })

    expect(report.summary.sessions).toBe(1)
    expect(report.summary.suspiciousSessions).toBe(0)
    expect(report.sessions[0]).toMatchObject({
      clickId: 'gclid-good',
      status: 'healthy',
      leadId: '11111111-1111-4111-8111-111111111111',
    })
  })

  it('flags repeated OpenAI Ads server-only clicks by oppref and hashed IP', () => {
    const report = buildTrafficQualityReport([
      row({
        event_id: 'openai-1',
        traffic_source: 'openai_ads',
        campaign: 'OpenAI Ads',
        page_location: 'https://savingkc.com/ppc?oppref=oppref-a',
        page_referrer: 'https://chatgpt.com/',
        payload: { ...device('ip-repeat', 'ua-a'), server_side: true, attribution: { oppref: 'oppref-a', utm_source: 'openai_ads' } },
      }),
      row({
        event_id: 'openai-2',
        traffic_source: 'openai_ads',
        campaign: 'OpenAI Ads',
        page_location: 'https://savingkc.com/ppc?oppref=oppref-b',
        page_referrer: 'https://chatgpt.com/',
        payload: { ...device('ip-repeat', 'ua-b'), server_side: true, attribution: { oppref: 'oppref-b', utm_source: 'openai_ads' } },
      }),
      row({
        event_id: 'openai-3',
        traffic_source: 'openai_ads',
        campaign: 'OpenAI Ads',
        page_location: 'https://savingkc.com/ppc?oppref=oppref-c',
        page_referrer: 'https://chatgpt.com/',
        payload: { ...device('ip-repeat', 'ua-c'), server_side: true, attribution: { oppref: 'oppref-c', utm_source: 'openai_ads' } },
      }),
    ], { now: '2026-06-06T14:02:00.000Z' })

    expect(report.summary.sessions).toBe(3)
    expect(report.summary.suspiciousSessions).toBe(3)
    expect(report.summary.repeatIpClusters).toBe(1)
    expect(report.sources[0]).toMatchObject({
      label: 'openai_ads / OpenAI Ads',
      sessions: 3,
      suspicious: 3,
      suspiciousRate: 100,
    })
    expect(report.sessions.map((session) => session.clickId)).toEqual(['oppref-a', 'oppref-b', 'oppref-c'])
  })
})
