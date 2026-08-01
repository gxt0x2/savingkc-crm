export interface DeadReasonDef {
  id: string
  label: string
}

export const DEAD_REASONS: DeadReasonDef[] = [
  { id: 'dnc_refused', label: 'Do not call / Refused' },
  { id: 'wrong_or_disconnected', label: 'Wrong or disconnected number' },
  { id: 'spam_vendor_duplicate', label: 'Spam / Vendor / Duplicate' },
  { id: 'sold_or_competitor', label: 'Already sold / Went with someone else' },
  { id: 'listed_agent', label: 'Listed with an agent' },
  { id: 'not_selling', label: 'Not selling / Not pursuing' },
  { id: 'no_legal_interest', label: 'Not the owner / No legal interest' },
  { id: 'low_offer_or_equity', label: 'Offer too low / Not enough equity' },
  { id: 'outside_buy_box', label: 'Outside buy box' },
  { id: 'title_probate_bankruptcy_legal', label: 'Title, probate, bankruptcy, or legal issue' },
  { id: 'other', label: 'Other — see notes' },
]

const DEAD_REASON_BY_ID = new Map(DEAD_REASONS.map((r) => [r.id, r]))

/**
 * Older imports and disposition integrations used narrower reason ids. Keep
 * accepting them, but normalize every new write into the eleven reporting
 * buckets agents actually use.
 */
const LEGACY_DEAD_REASON_ALIASES: Record<string, string> = {
  dnc: 'dnc_refused',
  refused: 'dnc_refused',
  wrong_number: 'wrong_or_disconnected',
  disconnected: 'wrong_or_disconnected',
  no_phones: 'wrong_or_disconnected',
  spam: 'spam_vendor_duplicate',
  duplicate: 'spam_vendor_duplicate',
  went_with_someone_else: 'sold_or_competitor',
  already_sold: 'sold_or_competitor',
  listed: 'listed_agent',
  not_pursuing: 'not_selling',
  not_owner: 'no_legal_interest',
  wrong_family: 'no_legal_interest',
  offer_too_low: 'low_offer_or_equity',
  no_equity: 'low_offer_or_equity',
  title_or_legal_issue: 'title_probate_bankruptcy_legal',
  bankruptcy_legal: 'title_probate_bankruptcy_legal',
  no_living_heirs: 'title_probate_bankruptcy_legal',
  system_triage: 'other',
}

export function canonicalDeadReason(id: string | null | undefined): string | null {
  if (!id) return null
  const normalized = id.trim().toLowerCase()
  if (DEAD_REASON_BY_ID.has(normalized)) return normalized
  return LEGACY_DEAD_REASON_ALIASES[normalized] ?? null
}

export function deadReasonLabel(id: string | null | undefined): string {
  if (!id) return ''
  const def = DEAD_REASON_BY_ID.get(canonicalDeadReason(id) ?? id)
  if (def) return def.label
  return String(id)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function isValidDeadReason(id: string | null | undefined): boolean {
  return canonicalDeadReason(id) !== null
}

export function cleanDeadReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return canonicalDeadReason(value)
}

export function isNotLeadOutcome(
  classification: string | null | undefined,
  station: string | null | undefined,
): boolean {
  const normalizedClassification = classification?.trim().toLowerCase()
  const normalizedStation = station?.trim().toLowerCase()
  return normalizedClassification === 'dead' || ['dead', 'closed_lost'].includes(normalizedStation ?? '')
}
