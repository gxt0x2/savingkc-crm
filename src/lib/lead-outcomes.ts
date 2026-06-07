export interface DeadReasonDef {
  id: string
  label: string
}

export const DEAD_REASONS: DeadReasonDef[] = [
  { id: 'dnc', label: 'Do not call' },
  { id: 'spam', label: 'Spam / vendor' },
  { id: 'went_with_someone_else', label: 'Went with someone else' },
  { id: 'offer_too_low', label: 'Offer too low' },
  { id: 'not_selling', label: 'Not selling anymore' },
  { id: 'not_owner', label: 'Not the owner' },
  { id: 'wrong_number', label: 'Wrong number' },
  { id: 'disconnected', label: 'Disconnected / bad number' },
  { id: 'already_sold', label: 'Property already sold' },
  { id: 'listed', label: 'Listed with an agent' },
  { id: 'outside_buy_box', label: 'Outside buy box' },
  { id: 'no_equity', label: 'Not enough equity' },
  { id: 'title_or_legal_issue', label: 'Title / legal issue' },
  { id: 'duplicate', label: 'Duplicate record' },
  { id: 'no_living_heirs', label: 'No living heirs found' },
  { id: 'wrong_family', label: 'Not the right family / no relation' },
  { id: 'no_phones', label: 'No good phone numbers' },
  { id: 'not_pursuing', label: 'Not worth pursuing' },
  { id: 'refused', label: 'Refused / hostile' },
  { id: 'bankruptcy_legal', label: 'Bankruptcy / legal hold' },
  { id: 'system_triage', label: 'System triage' },
  { id: 'other', label: 'Other (see notes)' },
]

const DEAD_REASON_BY_ID = new Map(DEAD_REASONS.map((r) => [r.id, r]))

export function deadReasonLabel(id: string | null | undefined): string {
  if (!id) return ''
  const def = DEAD_REASON_BY_ID.get(id)
  if (def) return def.label
  return String(id)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function isValidDeadReason(id: string | null | undefined): boolean {
  return Boolean(id && DEAD_REASON_BY_ID.has(id))
}

export function cleanDeadReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return isValidDeadReason(trimmed) ? trimmed : null
}
