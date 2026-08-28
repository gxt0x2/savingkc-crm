export const DEAL_LEDGER_CATEGORIES = [
  'assignment_fee',
  'transaction_fee',
  'emd',
  'overhead',
  'other',
] as const

export const DEAL_LEDGER_DIRECTIONS = ['in', 'out'] as const

export type DealLedgerCategory = (typeof DEAL_LEDGER_CATEGORIES)[number]
export type DealLedgerDirection = (typeof DEAL_LEDGER_DIRECTIONS)[number]

export interface DealLedgerLine {
  id: string
  lead_id: string
  tc_file_id: string | null
  dispo_deal_id: string | null
  file_number: string | null
  property_address: string | null
  amount: number
  direction: DealLedgerDirection
  posted_on: string
  source: string
  memo: string | null
  category: DealLedgerCategory
  idempotency_key: string
  actor: string
  created_at: string
}

export const DEAL_LEDGER_CATEGORY_LABELS: Record<DealLedgerCategory, string> = {
  assignment_fee: 'Assignment fee',
  transaction_fee: 'Transaction fee',
  emd: 'EMD',
  overhead: 'Overhead',
  other: 'Other',
}
