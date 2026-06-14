import { describe, expect, it } from 'vitest'
import {
  alertChannel,
  buildLeadAlertSummary,
  isLeadAlertMetadata,
  normalizeLeadAlertDelivery,
  readLeadAlertCallback,
  resolveLeadAlertCallback,
} from './lead-alerts'

describe('marketing lead alert helpers', () => {
  it('detects outbound lead alert metadata shapes', () => {
    expect(isLeadAlertMetadata({ direction: 'outbound_alert' })).toBe(true)
    expect(isLeadAlertMetadata({ trigger: 'website_lead_alert' })).toBe(true)
    expect(isLeadAlertMetadata({ trigger: 'google_ads_inbound_call_started' })).toBe(true)
    expect(isLeadAlertMetadata({ delivery_status: [{ success: true }] })).toBe(true)
    expect(isLeadAlertMetadata({ source: 'ordinary_note' })).toBe(false)
  })

  it('normalizes delivery status across website, PPC, and Google Ads call paths', () => {
    expect(normalizeLeadAlertDelivery({
      to_agents: ['Ernest', 'Casey'],
      to_agent_phones: ['+18162262552', '+18167564943'],
      delivery_status: [
        { target: 'Ernest', to: '+18162262552', success: true, sid: 'SM1' },
        { status: 'fulfilled', value: { to: '+18167564943', success: false, error: 'blocked' } },
      ],
    })).toEqual([
      { target: 'Ernest', to: '+18162262552', success: true, sid: 'SM1', error: null, status: null },
      { target: 'Casey', to: '+18167564943', success: false, sid: null, error: 'blocked', status: 'fulfilled' },
    ])
  })

  it('resolves callback claim and seller outcome from later call activities', () => {
    const callback = readLeadAlertCallback({
      form_agent_callback: {
        started: true,
        batchId: 'lead-1-123',
        calls: [{ agentName: 'Ernest', to: '+18162262552', started: true, sid: 'CA1' }],
      },
    })

    expect(resolveLeadAlertCallback(callback, [
      {
        lead_id: 'lead-1',
        description: 'PPC form callback claimed by Ernest',
        created_at: '2026-06-04T14:00:00.000Z',
        metadata: { source: 'ppc_form_agent_callback', batch_id: 'lead-1-123', outcome: 'agent_claimed', agentName: 'Ernest' },
      },
      {
        lead_id: 'lead-1',
        description: 'PPC form seller did not answer agent-assisted callback',
        created_at: '2026-06-04T14:03:00.000Z',
        metadata: { source: 'ppc_form_agent_callback', batchId: 'lead-1-123', outcome: 'missed', dialStatus: 'no-answer' },
      },
    ])).toEqual({
      claimedBy: 'Ernest',
      claimedAt: '2026-06-04T14:00:00.000Z',
      outcome: 'missed',
      outcomeAt: '2026-06-04T14:03:00.000Z',
      dialStatus: 'no-answer',
    })
  })

  it('summarizes alert coverage and callback health', () => {
    const summary = buildLeadAlertSummary([
      {
        recipients: ['Ernest', 'Casey'],
        delivery: [
          { target: 'Ernest', to: '+18162262552', success: true, sid: 'SM1', error: null, status: null },
          { target: 'Casey', to: '+18167564943', success: false, sid: null, error: 'blocked', status: null },
        ],
        callback: { started: true, sid: 'CA1', to: '+18162262552', batchId: 'b1', calls: [], error: null },
        callbackResolution: { claimedBy: 'Ernest', claimedAt: '2026-06-04T14:00:00.000Z', outcome: 'connected', outcomeAt: '2026-06-04T14:03:00.000Z', dialStatus: 'completed' },
        trigger: 'ppc_lead_alert',
        trafficSource: 'google_ads',
      },
      {
        recipients: [],
        delivery: [],
        callback: null,
        callbackResolution: { claimedBy: null, claimedAt: null, outcome: null, outcomeAt: null, dialStatus: null },
        trigger: 'known_missed_call_alert',
        trafficSource: null,
      },
    ])

    expect(summary).toMatchObject({
      total: 2,
      smsSucceeded: 1,
      smsFailed: 1,
      callbacksStarted: 1,
      callbacksClaimed: 1,
      callbacksConnected: 1,
      noRecipients: 1,
      ernestIncluded: 1,
      caseyIncluded: 1,
      googleAds: 1,
      formAlerts: 1,
      callAlerts: 1,
    })
  })

  it('classifies alert channels from trigger names', () => {
    expect(alertChannel('ppc_lead_alert')).toBe('form')
    expect(alertChannel('google_ads_inbound_call_started')).toBe('call')
    expect(alertChannel('yes_reply_alert')).toBe('sms')
    expect(alertChannel('booking_alert')).toBe('booking')
  })
})
