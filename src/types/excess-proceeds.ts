export const EXCESS_PROCEEDS_TRACK = 'excess_proceeds' as const
export const JACKSON_DLT_SOURCE = 'jackson_dlt' as const

export const COUNSEL_STATUSES = ['pending', 'clear', 'blocked'] as const
export const FORM_PACK_STATUSES = ['none', 'drafted', 'signed'] as const

export type CounselStatus = (typeof COUNSEL_STATUSES)[number]
export type FormPackStatus = (typeof FORM_PACK_STATUSES)[number]
export type ExcessProceedsSort = 'score' | 'excess_amount'
export type ExcessProceedsFilter =
  | 'all'
  | 'payout_ready'
  | 'claim_elapsed'
  | 'application_filed'
  | 'handoff_ready'

/**
 * Recommended path for this lane. These are labels on the existing Deal File
 * stations. This lane does not add stages.
 *
 * raw → new
 * enriched → qualified
 * in_conversation → contacted
 * under_contract → under_contract (services agreement)
 * closed → closed_won (funds recovered)
 * dead → dead
 */
export const EXCESS_PROCEEDS_STAGE_PATH = [
  { lane: 'raw', station: 'new', meaning: 'County row imported. Not worked yet.' },
  { lane: 'enriched', station: 'qualified', meaning: 'Facts checked. Score stays empty until someone sets it.' },
  { lane: 'in_conversation', station: 'contacted', meaning: 'Owner conversation is underway. Call uses the CRM dialer.' },
  { lane: 'under_contract', station: 'under_contract', meaning: 'Services agreement signed.' },
  { lane: 'closed', station: 'closed_won', meaning: 'Funds recovered. Fee income posts on the Deal File ledger.' },
  { lane: 'dead', station: 'dead', meaning: 'Not pursuing.' },
] as const

export const EXCESS_PROCEEDS_IMPORT_LIMIT = 1000
export const EXCESS_PROCEEDS_LIST_LIMIT = 500
export const DEFAULT_SURPLUS_FEE_PCT = 10

export interface ExcessProceedsUpsertRow {
  suit_no: string
  parcel_no: string
  owner_name: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  sale_date: string | null
  sale_date_provided: boolean
  purchase_price: number | null
  purchase_price_provided: boolean
  judgment_amount: number | null
  judgment_amount_provided: boolean
  excess_amount: number | null
  excess_amount_provided: boolean
  confirmed_date: string | null
  confirmed_date_provided: boolean
  deed_date: string | null
  deed_date_provided: boolean
  set_aside_date: string | null
  set_aside_date_provided: boolean
  refund_date: string | null
  refund_date_provided: boolean
  excess_application_filed_date: string | null
  excess_application_filed_date_provided: boolean
  excess_denied_date: string | null
  excess_denied_date_provided: boolean
  excess_paid_date: string | null
  excess_paid_date_provided: boolean
  zestimate: number | null
  zestimate_as_of: string | null
  zestimate_provided: boolean
  score: number | null
  score_provided: boolean
  owner_is_entity: boolean
  owner_is_entity_provided: boolean
  counsel_status: CounselStatus | null
  counsel_status_provided: boolean
  form_pack_status: FormPackStatus | null
  form_pack_status_provided: boolean
  payout_ready: boolean | null
  payout_ready_provided: boolean
  surplus_fee_pct: number | null
  surplus_fee_pct_provided: boolean
  form_pack_url: string | null
  form_pack_url_provided: boolean
}

export interface ExcessProceedsFile {
  id: string
  lead_id: string
  track: typeof EXCESS_PROCEEDS_TRACK
  county_source: typeof JACKSON_DLT_SOURCE
  suit_no: string
  parcel_no: string
  owner_name: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  station: string | null
  sale_date: string | null
  purchase_price: number | null
  judgment_amount: number | null
  excess_amount: number | null
  claim_deadline: string | null
  claim_period_elapsed: boolean
  days_to_claim_deadline: number | null
  confirmed_date: string | null
  deed_date: string | null
  set_aside_date: string | null
  refund_date: string | null
  excess_application_filed_date: string | null
  excess_denied_date: string | null
  excess_paid_date: string | null
  payout_ready: boolean
  zestimate: number | null
  zestimate_as_of: string | null
  score: number | null
  owner_is_entity: boolean
  counsel_status: CounselStatus
  form_pack_status: FormPackStatus
  form_pack_url: string | null
  surplus_fee_pct: number
  handoff_ready: boolean
}

export interface ExcessProceedsPatch {
  sale_date?: string | null
  purchase_price?: number | null
  judgment_amount?: number | null
  excess_amount?: number | null
  confirmed_date?: string | null
  deed_date?: string | null
  set_aside_date?: string | null
  refund_date?: string | null
  excess_application_filed_date?: string | null
  excess_denied_date?: string | null
  excess_paid_date?: string | null
  payout_ready?: boolean
  zestimate?: number | null
  zestimate_as_of?: string | null
  score?: number | null
  owner_is_entity?: boolean
  counsel_status?: CounselStatus
  form_pack_status?: FormPackStatus
  form_pack_url?: string | null
  surplus_fee_pct?: number
}

export function chicagoToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now)
}

/** RSMo 141.580.4: two years from the sale. Feb 29 clamps to Feb 28. */
export function claimDeadlineFromSaleDate(saleDate: string | null): string | null {
  if (!saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return null
  const [year, month, day] = saleDate.split('-').map(Number)
  const targetYear = year + 2
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  const clamped = Math.min(day, lastDay)
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

export function claimPeriodElapsed(deadline: string | null, today: string): boolean {
  return Boolean(deadline && deadline < today)
}

export function daysToClaimDeadline(deadline: string | null, today: string): number | null {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null
  const deadlineMs = Date.parse(`${deadline}T00:00:00Z`)
  const todayMs = Date.parse(`${today}T00:00:00Z`)
  return Math.round((deadlineMs - todayMs) / 86_400_000)
}

export function excessProceedsHandoffReady(file: {
  counsel_status: CounselStatus
  form_pack_status: FormPackStatus
  payout_ready: boolean
  claim_period_elapsed: boolean
}): boolean {
  return file.counsel_status === 'clear'
    && file.form_pack_status === 'signed'
    && file.payout_ready
    && !file.claim_period_elapsed
}

export function excessProceedsLedgerSource(suitNo: string, parcelNo: string, kind: 'recovery' | 'fee'): string {
  return `jackson-dlt:${suitNo}:${parcelNo}:${kind}`
}

export function ownerNameLooksLikeEntity(ownerName: string | null): boolean {
  if (!ownerName) return false
  return /\b(LLC|L\.?\s*L\.?\s*C\.?|INC|INCORPORATED|CORP|CORPORATION|TRUST|ESTATE|BANK|LP|LLP|ASSOCIATION|CHURCH|HOLDINGS|PROPERTIES|PARTNERS|CITY OF|COUNTY OF)\b/i.test(ownerName)
}
