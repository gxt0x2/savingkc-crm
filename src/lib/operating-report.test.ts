import { describe, expect, it } from 'vitest'

import { buildOperatingReport, type OperatingReportInput } from './operating-report'

function input(overrides: Partial<OperatingReportInput> = {}): OperatingReportInput {
  return {
    period: '30d',
    since: '2026-07-03T00:00:00.000Z',
    until: '2026-08-02T18:00:00.000Z',
    leads: [
      { id: 'lead-1', full_name: 'Seller One', property_address: '1 Main St', city: 'Kansas City', source: 'google_ads', station: 'under_contract', priority: 'hot', assigned_agent: 'Ernest', opportunity_score: 82, is_favorite: false, phone: '+18165550100', email: 'one@example.com', created_at: '2026-07-10T12:00:00.000Z' },
      { id: 'lead-2', full_name: 'Seller Two', property_address: '2 Oak St', city: 'Raytown', source: 'referral', station: 'qualified', priority: 'warm', assigned_agent: null, opportunity_score: 60, is_favorite: false, phone: '+18165550200', email: null, created_at: '2026-07-11T12:00:00.000Z' },
    ],
    threads: [
      { id: 'lead-1', attentionState: 'waiting_on_contact', owner: 'Ernest', lastActivityAt: '2026-07-12T12:10:00.000Z', primaryNextAction: { overdue: false } },
      { id: 'lead-2', attentionState: 'needs_reply', owner: null, lastActivityAt: '2026-07-12T12:15:00.000Z', primaryNextAction: null },
    ],
    activities: [
      { id: 'a1', lead_id: 'lead-1', activity_type: 'call', description: 'Outbound call connected live', agent: 'Ernest', metadata: { direction: 'outbound', outcome: 'connected', duration_seconds: 180 }, created_at: '2026-07-10T12:05:00.000Z' },
      { id: 'a2', lead_id: 'lead-1', activity_type: 'sms_outbound', description: 'Follow up', agent: 'Ernest', metadata: { direction: 'outbound' }, created_at: '2026-07-10T12:06:00.000Z' },
      { id: 'a3', lead_id: 'lead-1', activity_type: 'sms_inbound', description: 'Yes', agent: 'Ernest', metadata: { direction: 'inbound' }, created_at: '2026-07-10T12:07:00.000Z' },
    ],
    appointments: [{ id: 'appt-1', lead_id: 'lead-1', status: 'attended', source: 'google_ads', scheduled_at: '2026-07-15T14:00:00.000Z', created_at: '2026-07-12T12:00:00.000Z' }],
    deals: [{ id: 'deal-1', lead_id: 'lead-1', stage: 'closed', entered_at: '2026-07-10T12:00:00.000Z', assignment_fee: 25_000, close_date: '2026-07-30', accepted_offer_id: 'offer-1', accepted_buyer_id: 'buyer-1', closeout_status: 'awaiting_debrief', debrief_due_at: '2026-08-01T12:00:00.000Z', debrief_completed_at: null, created_at: '2026-07-10T12:00:00.000Z', updated_at: '2026-07-30T12:00:00.000Z' }],
    offers: [{ id: 'offer-1', lead_id: 'lead-1', buyer_id: 'buyer-1', offer_amount: 150_000, close_days: 14, status: 'accepted', submitted_at: '2026-07-15T12:00:00.000Z', decided_at: '2026-07-16T12:00:00.000Z', created_at: '2026-07-15T12:00:00.000Z' }],
    buyers: [{ id: 'buyer-1', status: 'active', tier: 'vip', deals_closed: 2, last_deal_date: '2026-07-30', created_at: '2026-01-01T00:00:00.000Z' }],
    revenue: [{ id: 'revenue-1', amount: 25_000, date: '2026-07-30', source: 'closing', deal_id: 'lead-1', property_address: '1 Main St' }],
    expenses: [{ id: 'expense-1', amount: 5_000, date: '2026-07-20', source: 'mercury', category: 'marketing', description: 'Google Ads' }],
    availability: { leads: true, conversations: true, appointments: true, dispositions: true, offers: true, buyers: true, finance: true, activityComplete: true },
    ...overrides,
  }
}

describe('buildOperatingReport', () => {
  it('builds executive, acquisition, communication, disposition, and finance metrics from records', () => {
    const report = buildOperatingReport(input())

    expect(report.core).toMatchObject({ revenue: 25_000, expenses: 5_000, netRevenue: 20_000, leads: 2, qualified: 2, underContract: 1, needsReply: 1 })
    expect(report.acquisitions.averageSpeedToLeadMinutes).toBe(5)
    expect(report.acquisitions.appointmentShowRate).toBe(100)
    expect(report.acquisitions.costs).toEqual({ recordedSpend: 5_000, rows: 1, costPerLead: 2_500, costPerOpportunity: 2_500, costPerTransaction: 5_000 })
    expect(report.communications).toMatchObject({ calls: 1, callDurationSeconds: 180, averageCallDurationSeconds: 180, connectedCalls: 1, callConnectionRate: 100, sms: 2, inboundSms: 1, outboundSms: 1, unclassifiedSms: 0, smsResponseRate: 100 })
    expect(report.communications.agents[0]).toMatchObject({ agent: 'Ernest', callDurationSeconds: 180, averageCallDurationSeconds: 180 })
    expect(report.dispositions).toMatchObject({ assignedDeals: 1, closedDeals: 1, offers: 1, averageDaysToBuyer: 6, assignmentRevenue: 25_000, averageAssignmentFee: 25_000, debriefOutstanding: 1 })
    expect(report.finance).toMatchObject({ grossRevenue: 25_000, expenses: 5_000, netRevenue: 20_000, profitMargin: 80 })
  })

  it('reports absent measurements as null rather than inventing a zero-value KPI', () => {
    const report = buildOperatingReport(input({ deals: [], offers: [], appointments: [], revenue: [], expenses: [], activities: [] }))

    expect(report.dispositions.averageDaysToBuyer).toBeNull()
    expect(report.dispositions.averageAssignmentFee).toBeNull()
    expect(report.finance.averageRevenuePerTransaction).toBeNull()
    expect(report.acquisitions.appointmentShowRate).toBeNull()
    expect(report.communications.callConnectionRate).toBeNull()
  })

  it('keeps source outcomes and deterministic insights attached to real records', () => {
    const report = buildOperatingReport(input())

    expect(report.marketing.sources[0]).toMatchObject({ source: 'google_ads', leads: 1, qualified: 1, contracts: 1, revenue: 25_000 })
    expect(report.insights).toContain('1 seller conversation needs a response among leads in this period.')
    expect(report.bottlenecks.find((row) => row.key === 'needs-reply')).toMatchObject({ label: 'Needs reply among period leads' })
    expect(report.bottlenecks.find((row) => row.key === 'debriefs')).toMatchObject({ label: 'Closeouts due among period deals', count: 1, severity: 'high' })
  })

  it('uses only verified outcome evidence for Marketing revenue when the ledger is available', () => {
    const report = buildOperatingReport(input({
      marketingOutcomes: [
        { id: 'outcome-1', lead_id: 'lead-1', outcome: 'closed_won', revenue: 18_500, lead_source: 'google_ads', occurred_at: '2026-07-30T18:00:00.000Z', evidence_type: 'funded_closeout' },
        { id: 'outcome-2', lead_id: 'lead-2', outcome: 'fell_through', revenue: 0, lead_source: 'referral', occurred_at: '2026-07-31T18:00:00.000Z', evidence_type: 'verified_fallout' },
      ],
    }))
    expect(report.marketing.verifiedOutcomes).toEqual({ total: 2, closedWon: 1, fellThrough: 1, revenue: 18_500 })
    expect(report.marketing.sources.find((row) => row.source === 'google_ads')).toMatchObject({ revenue: 18_500 })
    expect(report.marketing.sources.find((row) => row.source === 'referral')).toMatchObject({ revenue: 0 })
  })

  it('combines case-only agent identity variants without changing activity totals', () => {
    const report = buildOperatingReport(input({
      activities: [
        { id: 'a1', lead_id: 'lead-1', activity_type: 'call', description: 'Connected', agent: 'Casey', metadata: { outcome: 'connected' }, created_at: '2026-07-10T12:05:00.000Z' },
        { id: 'a2', lead_id: 'lead-1', activity_type: 'sms_outbound', description: 'Follow up', agent: 'casey', metadata: { direction: 'outbound' }, created_at: '2026-07-10T12:06:00.000Z' },
      ],
    }))

    expect(report.communications.agents).toEqual([
      expect.objectContaining({ agent: 'Casey', calls: 1, connected: 1, sms: 1 }),
    ])
  })

  it('surfaces SMS records whose direction is not recorded', () => {
    const report = buildOperatingReport(input({
      activities: [
        { id: 'a1', lead_id: 'lead-1', activity_type: 'sms', description: 'Message event', agent: 'System', metadata: {}, created_at: '2026-07-10T12:05:00.000Z' },
      ],
    }))

    expect(report.communications).toMatchObject({ sms: 1, inboundSms: 0, outboundSms: 0, unclassifiedSms: 1 })
  })

  it('keeps not-lead outcomes in qualification reporting but out of active-work attention', () => {
    const base = input()
    const report = buildOperatingReport(input({
      leads: [
        ...base.leads,
        { id: 'lead-dead', full_name: 'Wrong Number', property_address: null, city: null, source: 'direct_mail', station: 'dead', priority: null, assigned_agent: null, opportunity_score: 0, classification: 'dead', dead_reason: 'wrong_number', is_favorite: false, phone: null, email: null, created_at: '2026-07-14T12:00:00.000Z' },
      ],
      threads: [
        ...base.threads,
        { id: 'lead-dead', attentionState: 'needs_reply', owner: null, lastActivityAt: null, primaryNextAction: null },
      ],
    }))

    expect(report.acquisitions).toMatchObject({ total: 3, notLeads: 1 })
    expect(report.acquisitions.attention.needsReply).toBe(1)
    expect(report.acquisitions.dataQuality.missingPhone).toBe(0)
    expect(report.acquisitions.unqualifiedReasons).toEqual([{ reason: 'Wrong or disconnected number', count: 1 }])
    expect(report.acquisitions.unqualifiedBySource).toEqual([{ source: 'direct_mail', count: 1 }])
  })

  it('builds dashboard trends, configured goals, agent ownership, and offer management from recorded rows', () => {
    const base = input()
    const report = buildOperatingReport({
      ...base,
      leads: base.leads.map((lead, index) => ({ ...lead, assigned_agent: index === 0 ? 'Ernest' : null, offer_amount: index === 0 ? 112_000 : null })),
      deals: [
        ...base.deals,
        { id: 'deal-2', lead_id: 'lead-2', stage: 'marketing', entered_at: '2026-07-20T12:00:00.000Z', assignment_fee: null, close_date: null, accepted_buyer_id: null, created_at: '2026-07-20T12:00:00.000Z', updated_at: '2026-07-20T12:00:00.000Z' },
      ],
      offers: [
        ...base.offers,
        { id: 'offer-2', lead_id: 'lead-2', buyer_id: 'buyer-1', offer_amount: 145_000, close_days: 12, status: 'submitted', submitted_at: '2026-07-21T12:00:00.000Z', decided_at: null, created_at: '2026-07-21T12:00:00.000Z' },
      ],
      goals: { monthlyRevenue: 15_000, monthlyClosings: 2, dailyCalls: 50, weeklyQualified: 5, weeklyAppointments: 2 },
    })

    expect(report.trends.leads).toHaveLength(12)
    expect(report.trends.leads.reduce((sum, point) => sum + point.value, 0)).toBe(2)
    expect(report.core).toMatchObject({ assigned: 1, pipelineOfferValue: 112_000 })
    expect(report.acquisitions.agents[0]).toMatchObject({ agent: 'Ernest', leads: 1, contracts: 1 })
    expect(report.dispositions.offerManagement[0]).toMatchObject({ leadId: 'lead-2', offers: 1, highestOffer: 145_000 })
    expect(report.goals.monthlyRevenue).toBe(15_000)
  })
})
