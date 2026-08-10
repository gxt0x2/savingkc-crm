import { describe, expect, it } from 'vitest'

import { buildRevenueLiftModel } from './acquisitions-metrics-dashboard'
import { buildOperatingReport, type OperatingReportInput } from '@/lib/operating-report'

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
