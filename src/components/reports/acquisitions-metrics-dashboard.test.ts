import { describe, expect, it } from 'vitest'

import { buildFunnelGeometry, buildRevenueLiftModel } from './acquisitions-metrics-dashboard'
import { buildAcquisitionSourceRows } from '@/lib/acquisition-source-channels'
import { buildOperatingReport, type OperatingReport, type OperatingReportInput } from '@/lib/operating-report'

function reportWithOneHundredLeads() {
  const leads: OperatingReportInput['leads'] = Array.from({ length: 100 }, (_, index) => ({
    id: `lead-${index}`,
    full_name: `Seller ${index}`,
    property_address: null,
    city: null,
    source: 'google_ads',
    station: 'new',
    priority: null,
    assigned_agent: null,
    opportunity_score: 0,
    is_favorite: false,
    phone: null,
    email: null,
    created_at: '2026-07-10T12:00:00.000Z',
  }))
  return buildOperatingReport({
    period: '30d',
    since: '2026-07-03T00:00:00.000Z',
    until: '2026-08-02T18:00:00.000Z',
    leads,
    threads: [],
    activities: [],
    appointments: [],
    deals: [{ id: 'deal-1', lead_id: 'lead-1', stage: 'closed', entered_at: '2026-07-10T12:00:00.000Z', assignment_fee: 10_000, close_date: '2026-07-30', accepted_offer_id: 'offer-1', accepted_buyer_id: 'buyer-1', closeout_status: 'complete', debrief_due_at: null, debrief_completed_at: '2026-07-30T12:00:00.000Z', created_at: '2026-07-10T12:00:00.000Z', updated_at: '2026-07-30T12:00:00.000Z' }],
    offers: [{ id: 'offer-1', lead_id: 'lead-1', buyer_id: 'buyer-1', offer_amount: 100_000, close_days: 14, status: 'accepted', submitted_at: '2026-07-15T12:00:00.000Z', decided_at: '2026-07-16T12:00:00.000Z', created_at: '2026-07-15T12:00:00.000Z' }],
    buyers: [],
    revenue: [{ id: 'revenue-1', amount: 10_000, date: '2026-07-30', source: 'closing', deal_id: 'lead-1', property_address: null }],
    expenses: [],
    availability: { leads: true, conversations: true, appointments: true, dispositions: true, offers: true, buyers: true, finance: true, activityComplete: true },
  })
}

describe('buildRevenueLiftModel', () => {
  it('uses the supplied benchmark rates without presenting modeled lift as booked revenue', () => {
    const model = buildRevenueLiftModel(reportWithOneHundredLeads())

    expect(model.averageDealMargin).toBe(10_000)
    expect(model.projectedClosings).toBeCloseTo(3.072)
    expect(model.currentRevenue).toBe(10_000)
    expect(model.optimizedRevenue).toBeCloseTo(30_720)
    expect(model.revenueLift).toBeCloseTo(20_720)
  })
})

describe('buildAcquisitionSourceRows', () => {
  it('aggregates CRM aliases into the five acquisition channels in business order', () => {
    const sourceRows = [
      sourceRow('inbound_ivr_no_input', 7),
      sourceRow('Tax Delinquent Inbound Sms', 4),
      sourceRow('inbound_call', 3),
      sourceRow('inbound_sms', 1),
      sourceRow('google_ads', 2),
      sourceRow('ppc_tax', 1),
      sourceRow('mojo_call', 5),
      sourceRow('youtube', 6),
      sourceRow('referral', 9),
    ]

    expect(buildAcquisitionSourceRows(sourceRows)).toEqual([
      expect.objectContaining({ label: 'Google - General', leads: 2 }),
      expect.objectContaining({ label: 'Google - Tax', leads: 5 }),
      expect.objectContaining({ label: 'Cold Calls', leads: 5 }),
      expect.objectContaining({ label: 'Cold SMS', leads: 1 }),
      expect.objectContaining({ label: 'YouTube', leads: 6 }),
    ])
  })
})

describe('buildFunnelGeometry', () => {
  const stages = buildFunnelGeometry([
    { label: 'Leads', value: 100 },
    { label: 'Qualified', value: 60 },
    { label: 'Appointments', value: 30 },
    { label: 'Contracts', value: 10 },
    { label: 'Closed', value: 0 },
  ])

  it('keeps every stage centered and equally spaced', () => {
    expect(stages.map((stage) => stage.bottomY - stage.topY)).toEqual([40, 40, 40, 40, 40])
    expect(stages.map((stage) => stage.topLeft + stage.topRight)).toEqual([600, 600, 600, 600, 600])
    expect(stages.map((stage) => stage.bottomLeft + stage.bottomRight)).toEqual([600, 600, 600, 600, 600])
  })

  it('shares boundaries between stages and tapers toward a readable zero-value stem', () => {
    for (let index = 0; index < stages.length - 1; index += 1) {
      expect(stages[index].bottomLeft).toBe(stages[index + 1].topLeft)
      expect(stages[index].bottomRight).toBe(stages[index + 1].topRight)
    }
    expect(stages[0].topRight - stages[0].topLeft).toBe(360)
    expect(stages.at(-1)!.topRight - stages.at(-1)!.topLeft).toBe(20)
  })
})

function sourceRow(source: string, leads: number): OperatingReport['marketing']['sources'][number] {
  return { source, leads, qualified: 0, appointments: 0, contracts: 0, revenue: 0, qualificationRate: 0, contractRate: 0 }
}
