import type { OperatingLead, OperatingMoneyRow } from './operating-report'

export interface OperatingMarketingOutcome {
  id: string
  lead_id: string
  outcome: 'closed_won' | 'fell_through'
  revenue: number | null
  lead_source: string | null
  occurred_at: string
  evidence_type: string
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null
}

export function buildMarketingReport(
  leads: OperatingLead[],
  revenue: OperatingMoneyRow[],
  outcomes: OperatingMarketingOutcome[] | undefined,
) {
  const revenueByLead = new Map<string, number>()
  if (outcomes === undefined) {
    for (const row of revenue) {
      if (!row.deal_id) continue
      revenueByLead.set(row.deal_id, (revenueByLead.get(row.deal_id) ?? 0) + number(row.amount))
    }
  }
  const groups = new Map<string, { leads: number; qualified: number; appointments: number; contracts: number; revenue: number }>()
  for (const lead of leads) {
    const source = lead.source?.trim() || 'unknown'
    const stageIndex = ['new', 'contacted', 'qualified', 'appointment_set', 'offer_made', 'under_contract', 'closed_won'].indexOf(lead.station ?? 'new')
    const row = groups.get(source) ?? { leads: 0, qualified: 0, appointments: 0, contracts: 0, revenue: 0 }
    row.leads += 1
    if (stageIndex >= 2) row.qualified += 1
    if (stageIndex >= 3) row.appointments += 1
    if (stageIndex >= 5) row.contracts += 1
    row.revenue += revenueByLead.get(lead.id) ?? 0
    groups.set(source, row)
  }
  for (const outcome of outcomes ?? []) {
    const source = outcome.lead_source?.trim() || 'unknown'
    const row = groups.get(source) ?? { leads: 0, qualified: 0, appointments: 0, contracts: 0, revenue: 0 }
    row.revenue += number(outcome.revenue)
    groups.set(source, row)
  }
  return {
    sources: [...groups.entries()]
      .map(([source, row]) => ({ source, ...row, qualificationRate: percentage(row.qualified, row.leads), contractRate: percentage(row.contracts, row.leads) }))
      .sort((left, right) => right.leads - left.leads || right.revenue - left.revenue),
    verifiedOutcomes: {
      total: outcomes?.length ?? 0,
      closedWon: outcomes?.filter((row) => row.outcome === 'closed_won').length ?? 0,
      fellThrough: outcomes?.filter((row) => row.outcome === 'fell_through').length ?? 0,
      revenue: (outcomes ?? []).reduce((sum, row) => sum + number(row.revenue), 0),
    },
  }
}
