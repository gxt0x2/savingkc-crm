import {
  EXCESS_PROCEEDS_TRACK,
  JACKSON_DLT_SOURCE,
  claimDeadlineFromSaleDate,
  claimPeriodElapsed,
  daysToClaimDeadline,
  excessProceedsHandoffReady,
  type CounselStatus,
  type ExcessProceedsFile,
  type FormPackStatus,
} from '@/types/excess-proceeds'

export interface ExcessProceedsLeadJoin {
  full_name?: string | null
  property_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  phone?: string | null
  station?: string | null
}

export interface ExcessProceedsRow {
  id: string
  lead_id: string
  track?: string | null
  county_source?: string | null
  suit_no: string
  parcel_no: string
  owner_name?: string | null
  property_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  sale_date?: string | null
  purchase_price?: number | string | null
  judgment_amount?: number | string | null
  excess_amount?: number | string | null
  claim_deadline?: string | null
  confirmed_date?: string | null
  deed_date?: string | null
  set_aside_date?: string | null
  refund_date?: string | null
  excess_application_filed_date?: string | null
  excess_denied_date?: string | null
  excess_paid_date?: string | null
  payout_ready?: boolean | null
  zestimate?: number | string | null
  zestimate_as_of?: string | null
  score?: number | string | null
  owner_is_entity?: boolean | null
  counsel_status?: string | null
  form_pack_status?: string | null
  form_pack_url?: string | null
  surplus_fee_pct?: number | string | null
  leads?: ExcessProceedsLeadJoin | ExcessProceedsLeadJoin[] | null
}

function money(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? amount : null
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

function leadOf(row: ExcessProceedsRow): ExcessProceedsLeadJoin {
  if (Array.isArray(row.leads)) return row.leads[0] ?? {}
  return row.leads ?? {}
}

function counsel(value: string | null | undefined): CounselStatus {
  if (value === 'clear' || value === 'blocked' || value === 'pending') return value
  return 'pending'
}

function formPack(value: string | null | undefined): FormPackStatus {
  if (value === 'drafted' || value === 'signed' || value === 'none') return value
  return 'none'
}

export function presentExcessProceedsFile(row: ExcessProceedsRow, today: string): ExcessProceedsFile {
  const lead = leadOf(row)
  const saleDate = dateOnly(row.sale_date)
  const deadline = dateOnly(row.claim_deadline) ?? claimDeadlineFromSaleDate(saleDate)
  const elapsed = claimPeriodElapsed(deadline, today)
  const counselStatus = counsel(row.counsel_status)
  const formPackStatus = formPack(row.form_pack_status)
  const payoutReady = row.payout_ready === true
  const zestimate = money(row.zestimate)
  const zestimateAsOf = dateOnly(row.zestimate_as_of)
  return {
    id: row.id,
    lead_id: row.lead_id,
    track: EXCESS_PROCEEDS_TRACK,
    county_source: JACKSON_DLT_SOURCE,
    suit_no: row.suit_no,
    parcel_no: row.parcel_no,
    owner_name: lead.full_name ?? row.owner_name ?? null,
    property_address: lead.property_address ?? row.property_address ?? null,
    city: lead.city ?? row.city ?? null,
    state: lead.state ?? row.state ?? null,
    zip: lead.zip ?? row.zip ?? null,
    phone: lead.phone ?? null,
    station: lead.station ?? null,
    sale_date: saleDate,
    purchase_price: money(row.purchase_price),
    judgment_amount: money(row.judgment_amount),
    excess_amount: money(row.excess_amount),
    claim_deadline: deadline,
    claim_period_elapsed: elapsed,
    days_to_claim_deadline: daysToClaimDeadline(deadline, today),
    confirmed_date: dateOnly(row.confirmed_date),
    deed_date: dateOnly(row.deed_date),
    set_aside_date: dateOnly(row.set_aside_date),
    refund_date: dateOnly(row.refund_date),
    excess_application_filed_date: dateOnly(row.excess_application_filed_date),
    excess_denied_date: dateOnly(row.excess_denied_date),
    excess_paid_date: dateOnly(row.excess_paid_date),
    payout_ready: payoutReady,
    zestimate: zestimate !== null && zestimateAsOf ? zestimate : null,
    zestimate_as_of: zestimate !== null && zestimateAsOf ? zestimateAsOf : null,
    score: money(row.score),
    owner_is_entity: row.owner_is_entity === true,
    counsel_status: counselStatus,
    form_pack_status: formPackStatus,
    form_pack_url: row.form_pack_url ?? null,
    surplus_fee_pct: money(row.surplus_fee_pct) ?? 10,
    handoff_ready: excessProceedsHandoffReady({
      counsel_status: counselStatus,
      form_pack_status: formPackStatus,
      payout_ready: payoutReady,
      claim_period_elapsed: elapsed,
    }),
  }
}

export function matchesExcessProceedsFilter(
  file: ExcessProceedsFile,
  filter: 'all' | 'payout_ready' | 'claim_elapsed' | 'application_filed' | 'handoff_ready',
): boolean {
  if (filter === 'payout_ready') return file.payout_ready
  if (filter === 'claim_elapsed') return file.claim_period_elapsed
  if (filter === 'application_filed') return Boolean(file.excess_application_filed_date)
  if (filter === 'handoff_ready') return file.handoff_ready
  return true
}
