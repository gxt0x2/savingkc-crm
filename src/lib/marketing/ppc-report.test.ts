import { describe, expect, it } from 'vitest'
import { buildPpcReport, type PpcReportInput } from './ppc-report'

const baseInput: PpcReportInput = {
  days: 30,
  since: '2026-05-01T00:00:00.000Z',
  until: '2026-05-31T00:00:00.000Z',
  leads: [
    {
      id: 'lead-form',
      full_name: 'Arnold Seller',
      phone: '+18165553535',
      email: 'arnold@example.com',
      source: 'ppc-landing',
      station: 'qualified',
      priority: 'hot',
      property_address: '7017 Main St',
      city: 'Kansas City',
      created_at: '2026-05-20T14:00:00.000Z',
      updated_at: '2026-05-20T14:10:00.000Z',
      classification: null,
      opportunity_score: 85,
    },
    {
      id: 'lead-call',
      full_name: 'Google Ads Caller',
      phone: '+18165550000',
      email: null,
      source: 'google_ads_phone',
      station: 'appointment_set',
      priority: 'hot',
      property_address: null,
      city: null,
      created_at: '2026-05-21T14:00:00.000Z',
      updated_at: '2026-05-21T14:07:00.000Z',
      classification: null,
      opportunity_score: null,
    },
  ],
  manifests: [
    {
      lead_id: 'lead-form',
      created_at: '2026-05-20T14:00:00.000Z',
      manifest: {
        acquisition: {
          attribution: {
            gclid: 'click-form',
            utm_source: 'google',
            utm_medium: 'cpc',
            utm_campaign: 'Search 2026',
            utm_term: 'sell house fast kc',
            gad_campaignid: 'campaign-1',
            gad_adgroupid: 'adgroup-1',
          },
        },
      },
    },
  ],
  activities: [
    {
      id: 'activity-stage3',
      lead_id: 'lead-form',
      activity_type: 'status_change',
      description: 'PPC form reached step 3 with all required fields filled; submit was not pressed yet.',
      metadata: { source: 'ppc_form_autosave', form_status: 'stage_3_complete_no_submit' },
      created_at: '2026-05-20T14:05:00.000Z',
    },
    {
      id: 'activity-submit',
      lead_id: 'lead-form',
      activity_type: 'status_change',
      description: 'PPC form submitted.',
      metadata: { source: 'ppc_form_submit', form_status: 'submitted' },
      created_at: '2026-05-20T14:06:00.000Z',
    },
    {
      id: 'activity-call',
      lead_id: 'lead-call',
      activity_type: 'call',
      description: 'Inbound seller connected live with agent',
      metadata: {
        outcome: 'connected',
        direction: 'inbound',
        calledNumber: '+18166088808',
        tracking_number: '8166088808',
        dialCallSid: 'call-123',
        traffic_source: 'google_ads',
        campaign: 'Search 2026',
      },
      created_at: '2026-05-21T14:05:00.000Z',
    },
    {
      id: 'activity-call-2m',
      lead_id: 'lead-call',
      activity_type: 'status_change',
      description: 'Call quality milestone: Connected call 2+ minutes',
      metadata: {
        source: 'call_quality_milestone',
        event: 'call_connected_2m',
        dedupeKey: 'call-123',
        tracking_number: '8166088808',
        traffic_source: 'google_ads',
        campaign: 'Search 2026',
      },
      created_at: '2026-05-21T14:07:00.000Z',
    },
  ],
  outbox: [
    {
      id: 'outbox-submit',
      event_name: 'lead_submitted',
      event_category: 'form',
      dedupe_key: 'lead:lead-form:lead_submitted',
      status: 'sent',
      approved_for_google_ads: true,
      optimization_role: 'primary',
      lead_id: 'lead-form',
      conversion_value: 25,
      event_time: '2026-05-20T14:06:00.000Z',
      click_id: 'click-form',
      click_id_type: 'gclid',
      attribution: { gclid: 'click-form', utm_campaign: 'Search 2026' },
      payload: { form_status: 'submitted' },
      attempts: 1,
      last_error: null,
      sent_at: '2026-05-20T14:07:00.000Z',
      created_at: '2026-05-20T14:06:00.000Z',
    },
    {
      id: 'outbox-2m',
      event_name: 'call_connected_2m',
      event_category: 'call',
      dedupe_key: 'call:call-123:call_connected_2m',
      status: 'pending',
      approved_for_google_ads: false,
      optimization_role: 'secondary',
      lead_id: 'lead-call',
      conversion_value: 25,
      event_time: '2026-05-21T14:07:00.000Z',
      click_id: null,
      click_id_type: null,
      attribution: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'Search 2026' },
      payload: { traffic_source: 'google_ads', campaign: 'Search 2026' },
      attempts: 0,
      last_error: null,
      sent_at: null,
      created_at: '2026-05-21T14:07:00.000Z',
    },
  ],
  trackingEvents: [
    {
      id: 'event-visit',
      event_id: 'event-visit',
      event_name: 'ppc_visit_started',
      event_category: 'visit',
      event_time: '2026-05-20T14:00:00.000Z',
      session_id: 'session-form',
      visitor_id: 'visitor-form',
      lead_id: null,
      form_step: 1,
      form_status: null,
      situation_raw: null,
      timeline_raw: null,
      condition_raw: null,
      phone_number: null,
      sms_consent: null,
      is_test: false,
      attribution: { gclid: 'click-form' },
      payload: {},
      created_at: '2026-05-20T14:00:00.000Z',
    },
    {
      id: 'event-situation',
      event_id: 'event-situation',
      event_name: 'situation_selected',
      event_category: 'form',
      event_time: '2026-05-20T14:01:00.000Z',
      session_id: 'session-form',
      visitor_id: 'visitor-form',
      lead_id: null,
      form_step: 1,
      form_status: null,
      situation_raw: 'tax-delinquent',
      timeline_raw: null,
      condition_raw: null,
      phone_number: null,
      sms_consent: null,
      is_test: false,
      attribution: { gclid: 'click-form' },
      payload: {},
      created_at: '2026-05-20T14:01:00.000Z',
    },
    {
      id: 'event-step2',
      event_id: 'event-step2',
      event_name: 'form_step_completed',
      event_category: 'form',
      event_time: '2026-05-20T14:03:00.000Z',
      session_id: 'session-form',
      visitor_id: 'visitor-form',
      lead_id: null,
      form_step: 2,
      form_status: null,
      situation_raw: 'tax-delinquent',
      timeline_raw: 'asap',
      condition_raw: 'needs-work',
      phone_number: null,
      sms_consent: null,
      is_test: false,
      attribution: { gclid: 'click-form' },
      payload: {},
      created_at: '2026-05-20T14:03:00.000Z',
    },
    {
      id: 'event-submit',
      event_id: 'event-submit',
      event_name: 'lead_submitted',
      event_category: 'conversion',
      event_time: '2026-05-20T14:06:00.000Z',
      session_id: 'session-form',
      visitor_id: 'visitor-form',
      lead_id: 'lead-form',
      form_step: 3,
      form_status: 'submitted',
      situation_raw: 'tax-delinquent',
      timeline_raw: 'asap',
      condition_raw: 'needs-work',
      phone_number: null,
      sms_consent: true,
      is_test: false,
      attribution: { gclid: 'click-form' },
      payload: {},
      created_at: '2026-05-20T14:06:00.000Z',
    },
  ],
  appointments: [
    {
      id: 'appt-call',
      lead_id: 'lead-call',
      scheduled_at: '2026-05-22T15:00:00.000Z',
      status: 'scheduled',
      source: 'crm_call',
      created_at: '2026-05-21T14:10:00.000Z',
    },
  ],
  revenue: [
    {
      id: 'rev-call',
      deal_id: 'lead-call',
      amount: 12000,
      date: '2026-05-23',
      source: 'closing',
    },
  ],
};

describe('ppc report', () => {
  it('aggregates form, call, appointment, export, and revenue metrics', () => {
    const report = buildPpcReport(baseInput)

    expect(report.summary.totalLeads).toBe(2)
    expect(report.summary.paidVisits).toBe(1)
    expect(report.summary.optionSelections).toBe(1)
    expect(report.summary.step2Completions).toBe(1)
    expect(report.summary.consentedSubmits).toBe(1)
    expect(report.summary.formSubmits).toBe(1)
    expect(report.summary.stage3NoSubmit).toBe(0)
    expect(report.summary.callLeads).toBe(1)
    expect(report.summary.connectedCalls).toBe(1)
    expect(report.summary.call2m).toBe(1)
    expect(report.summary.appointments).toBe(1)
    expect(report.summary.revenue).toBe(12000)
    expect(report.exportHealth.primary).toBe(1)
    expect(report.exportHealth.secondary).toBe(1)
    expect(report.exportHealth.pending).toBe(1)
    expect(report.exportHealth.sent).toBe(1)
    expect(report.exportHealth.awaitingApproval).toBe(1)
  })

  it('keeps stage 3 completion separate from final submit', () => {
    const report = buildPpcReport({
      ...baseInput,
      activities: baseInput.activities.filter((activity) => activity.id !== 'activity-submit'),
      outbox: baseInput.outbox.filter((row) => row.id !== 'outbox-submit'),
    })

    expect(report.summary.formSubmits).toBe(0)
    expect(report.summary.stage3NoSubmit).toBe(1)
    expect(report.recentLeads.find((lead) => lead.id === 'lead-form')?.formStatus).toBe('stage_3_no_submit')
  })

  it('labels partial PPC captures as potential until step 3 is complete', () => {
    const report = buildPpcReport({
      ...baseInput,
      leads: [
        ...baseInput.leads,
        {
          id: 'lead-potential',
          full_name: 'PPC Potential Lead',
          phone: '+18165551212',
          email: null,
          source: 'ppc-landing',
          station: 'new',
          priority: 'normal',
          property_address: '900 Oak St',
          city: 'Kansas City',
          created_at: '2026-05-22T15:00:00.000Z',
          updated_at: '2026-05-22T15:01:00.000Z',
          classification: null,
          opportunity_score: null,
        },
      ],
      activities: [
        ...baseInput.activities,
        {
          id: 'activity-potential',
          lead_id: 'lead-potential',
          activity_type: 'status_change',
          description: 'PPC form captured a potential lead before final submit.',
          metadata: { source: 'ppc_form_potential', form_status: 'potential_no_submit' },
          created_at: '2026-05-22T15:01:00.000Z',
        },
      ],
    })

    expect(report.recentLeads.find((lead) => lead.id === 'lead-potential')?.formStatus).toBe('potential_no_submit')
  })

  it('excludes underscore-delimited QA traffic from production metrics', () => {
    const report = buildPpcReport({
      ...baseInput,
      trackingEvents: [
        ...baseInput.trackingEvents,
        {
          id: 'event-test-visit',
          event_id: 'skc_ppc_visit_started_codex_final_qa',
          event_name: 'ppc_visit_started',
          event_category: 'visit',
          event_time: '2026-05-22T14:00:00.000Z',
          session_id: 'codex_final_session',
          visitor_id: 'visitor-test',
          lead_id: null,
          gclid: 'codex_final_qa_123',
          form_step: 1,
          form_status: null,
          situation_raw: null,
          timeline_raw: null,
          condition_raw: null,
          phone_number: null,
          sms_consent: null,
          is_test: false,
          attribution: { gclid: 'codex_final_qa_123' },
          payload: {},
          created_at: '2026-05-22T14:00:00.000Z',
        },
      ],
    })

    expect(report.summary.paidVisits).toBe(1)
    expect(report.summary.testRecords).toBe(1)
  })
})
