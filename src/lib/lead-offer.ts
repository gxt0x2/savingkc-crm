export const OFFER_METHODS = ['verbal', 'written'] as const

export type OfferMethod = typeof OFFER_METHODS[number]

export interface LeadOfferInput {
  amount: number
  method: OfferMethod
  notes: string | null
}

export type LeadOfferParseResult =
  | { success: true; data: LeadOfferInput }
  | { success: false; error: string }

const TERMINAL_STAGES = new Set(['dead', 'closed_lost'])
const POST_OFFER_STAGES = new Set(['offer_made', 'under_contract', 'in_closing', 'contract', 'closed_won', 'closed'])

export function parseLeadOfferInput(value: unknown): LeadOfferParseResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false, error: 'Offer details are required.' }
  }

  const input = value as Record<string, unknown>
  const amount = typeof input.amount === 'number'
    ? input.amount
    : typeof input.amount === 'string'
      ? Number(input.amount.replace(/[$,\s]/g, ''))
      : Number.NaN
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    return { success: false, error: 'Enter a valid offer amount.' }
  }

  const method = typeof input.method === 'string' ? input.method.toLowerCase() : ''
  if (!OFFER_METHODS.includes(method as OfferMethod)) {
    return { success: false, error: 'Choose whether the offer was verbal or written.' }
  }

  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (notes.length > 1_000) {
    return { success: false, error: 'Offer notes must be 1,000 characters or fewer.' }
  }

  return {
    success: true,
    data: {
      amount: Math.round(amount),
      method: method as OfferMethod,
      notes: notes || null,
    },
  }
}

export function nextStageAfterOffer(currentStage: string | null | undefined): string | null {
  const normalized = String(currentStage || '').trim().toLowerCase()
  if (TERMINAL_STAGES.has(normalized)) return null
  if (POST_OFFER_STAGES.has(normalized)) return normalized
  return 'offer_made'
}

export function offerActivityDescription(input: LeadOfferInput): string {
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(input.amount)
  const method = input.method === 'written' ? 'Written' : 'Verbal'
  return `${method} offer made: ${amount}${input.notes ? ` — ${input.notes}` : ''}`
}
