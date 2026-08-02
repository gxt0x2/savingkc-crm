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
      { id: 'a1', lead_id: 'lead-1', activity_type: 'call', description: 'Outbound call connected live', agent: 'Ernest', metadata: { direction: 'outbound', outcome: 'connected' }, created_at: '2026-07-10T12:05:00.000Z' },
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
    expect(report.communications).toMatchObject({ calls: 1, connectedCalls: 1, callConnectionRate: 100, sms: 2, inboundSms: 1, outboundSms: 1, smsResponseRate: 100 })
    expect(report.dispositions).toMatchObject({ closedDeals: 1, offers: 1, averageDaysToBuyer: 6, assignmentRevenue: 25_000, averageAssignmentFee: 25_000, debriefOutstanding: 1 })
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
    expect(report.insights).toContain('1 seller conversation needs a response.')
    expect(report.bottlenecks.find((row) => row.key === 'debriefs')).toMatchObject({ count: 1, severity: 'high' })
  })
})
