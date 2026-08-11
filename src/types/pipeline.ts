// Canonical acquisition pipeline.
//
// Parking is intentionally separate from stage: a parked lead keeps its actual
// station and is removed from the active queue via leads.is_parked.

export type AcquisitionStage =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'appointment_set'
  | 'offer_made'

export type TerminalStage =
  | 'under_contract'
  | 'closed_won'
  | 'closed_lost'
  | 'dead'

export type DealStage = AcquisitionStage | TerminalStage
export type OpportunityBucket = 'acquisition' | 'in_closing' | 'archived' | 'parked'

export const ACQUISITION_STAGES: readonly AcquisitionStage[] = [
  'new',
  'contacted',
  'qualified',
  'appointment_set',
  'offer_made',
] as const

export const TERMINAL_STAGES: readonly TerminalStage[] = [
  'under_contract',
  'closed_won',
  'closed_lost',
  'dead',
] as const

export const ARCHIVED_STAGES: readonly TerminalStage[] = [
  'closed_won',
  'closed_lost',
  'dead',
] as const

export const STAGE_LABELS: Record<DealStage, string> = {
  new: 'New',
  contacted: 'Leads',
  qualified: 'Opportunity',
  appointment_set: 'Appointment Set',
  offer_made: 'Offer Made',
  under_contract: 'Under Contract',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  dead: 'Dead',
}

export interface ParkingState {
  is_parked: boolean
  parked_at: string | null
  parked_until: string | null
  parked_reason: string | null
}

const LEGACY_STAGE_MAP: Record<string, DealStage> = {
  intake: 'new',
  not_contacted: 'new',
  attempting_contact: 'contacted',
  qualifying: 'qualified',
  discovery: 'qualified',
  appt_set: 'appointment_set',
  appointment: 'appointment_set',
  offer: 'offer_made',
  offer_prep: 'offer_made',
  offer_presented: 'offer_made',
  negotiating: 'offer_made',
  negotiations: 'offer_made',
  nurture: 'contacted',
  contract: 'under_contract',
  contract_signed: 'under_contract',
  inspection: 'under_contract',
  closing_prep: 'under_contract',
  closing: 'under_contract',
  closed: 'closed_won',
  disposition: 'closed_won',
}

export function normalizeDealStage(station: string | null | undefined): DealStage | null {
  if (!station) return null
  if ((ACQUISITION_STAGES as readonly string[]).includes(station)) return station as DealStage
  if ((TERMINAL_STAGES as readonly string[]).includes(station)) return station as DealStage
  return LEGACY_STAGE_MAP[station] ?? null
}

export function classifyBucket(
  station: string | null | undefined,
  parked: boolean,
): OpportunityBucket {
  if (parked) return 'parked'

  const normalized = normalizeDealStage(station)
  if (normalized && (ACQUISITION_STAGES as readonly string[]).includes(normalized)) return 'acquisition'
  if (normalized === 'under_contract') return 'in_closing'
  return 'archived'
}
