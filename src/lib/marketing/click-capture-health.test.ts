import { describe, expect, it } from 'vitest'
import { buildClickCaptureHealth } from '@/lib/marketing/click-capture-health'

describe('click capture health', () => {
  it('flags imported OpenAI clicks that never reached the landing capture', () => {
    const report = buildClickCaptureHealth({
      generatedAt: '2026-06-23T12:00:00.000Z',
      campaignRows: [
        { campaign_name: 'SKC - General Sell & Cash (US)', paid_source: 'openai_ads', clicks: 4 },
      ],
      trackingRows: [],
      leadRows: [],
      outboxRows: [],
    })

    const openai = report.sources.find((source) => source.source === 'openai_ads')
    expect(report.status).toBe('attention')
    expect(openai?.status).toBe('attention')
    expect(openai?.platformClicks).toBe(4)
    expect(openai?.serverLandings).toBe(0)
    expect(openai?.message).toMatch(/no matching landing request/i)
  })

  it('separates server-side landings from replayable browser sessions', () => {
    const report = buildClickCaptureHealth({
      campaignRows: [
        { campaign_name: 'SKC - General Sell & Cash (US)', paid_source: 'openai_ads', clicks: 1 },
      ],
      trackingRows: [
        {
          id: 'landing-1',
          event_name: 'ppc_landing_request',
          session_id: 'server-session-1',
          utm_source: 'openai_ads',
          payload: { server_side: true, attribution: { skc_openai_click_id: 'skc_1' } },
        },
      ],
      leadRows: [],
      outboxRows: [],
    })

    const openai = report.sources.find((source) => source.source === 'openai_ads')
    expect(openai?.status).toBe('watch')
    expect(openai?.serverLandings).toBe(1)
    expect(openai?.browserSessions).toBe(0)
    expect(openai?.gaps.serverToBrowser).toBe(1)
  })

  it('counts a complete Google capture path through sent conversion export', () => {
    const report = buildClickCaptureHealth({
      campaignRows: [
        { campaign_name: 'Search 2026', paid_source: 'google_ads', clicks: 1 },
      ],
      trackingRows: [
        {
          id: 'server-1',
          event_name: 'ppc_landing_request',
          session_id: 'session-1',
          traffic_source: 'google_ads',
          gclid: 'GCLID_1',
          payload: { server_side: true },
        },
        {
          id: 'visit-1',
          event_name: 'ppc_visit_started',
          session_id: 'session-1',
          traffic_source: 'google_ads',
          gclid: 'GCLID_1',
        },
        {
          id: 'start-1',
          event_name: 'situation_selected',
          session_id: 'session-1',
          lead_id: 'lead-1',
          traffic_source: 'google_ads',
          gclid: 'GCLID_1',
          form_step: 1,
        },
        {
          id: 'step-1',
          event_name: 'lead_quiz_qualified',
          session_id: 'session-1',
          lead_id: 'lead-1',
          traffic_source: 'google_ads',
          gclid: 'GCLID_1',
          form_step: 3,
        },
      ],
      leadRows: [
        { id: 'lead-1', source: 'google_ads' },
      ],
      outboxRows: [
        {
          id: 'outbox-1',
          event_name: 'qualified_lead',
          status: 'sent',
          lead_id: 'lead-1',
          attribution: { gclid: 'GCLID_1', traffic_source: 'google_ads' },
        },
      ],
    })

    const google = report.sources.find((source) => source.source === 'google_ads')
    expect(google?.status).toBe('clean')
    expect(google?.platformClicks).toBe(1)
    expect(google?.serverLandings).toBe(1)
    expect(google?.browserSessions).toBe(1)
    expect(google?.formStarts).toBe(1)
    expect(google?.stepProgress).toBe(1)
    expect(google?.crmLeads).toBe(1)
    expect(google?.exportedConversions).toBe(1)
  })
})
