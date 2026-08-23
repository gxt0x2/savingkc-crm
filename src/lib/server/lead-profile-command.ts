export type LeadProfilePatch = Partial<{
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  source: string | null
  notes: string | null
  offer_amount: number
}>

export type LeadProfileCommandResult =
  | { ok: true; patch: LeadProfilePatch }
  | { ok: false; error: string }

const PROFILE_LIMITS = {
  full_name: 250,
  phone: 100,
  email: 320,
  property_address: 500,
  city: 150,
  state: 100,
  zip: 30,
  county: 150,
  source: 250,
  notes: 10_000,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nullableText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

export function buildLeadProfilePatch(input: unknown): LeadProfileCommandResult {
  if (!isRecord(input)) return { ok: false, error: 'Update command required' }

  if (input.kind === 'offer_amount') {
    const offerAmount = input.offerAmount
    if (typeof offerAmount !== 'number' || !Number.isFinite(offerAmount) || offerAmount <= 0 || offerAmount > 100_000_000) {
      return { ok: false, error: 'Valid offer amount required' }
    }
    return { ok: true, patch: { offer_amount: offerAmount } }
  }

  if (input.kind !== 'profile' || !isRecord(input.profile)) {
    return { ok: false, error: 'Unsupported lead update command' }
  }

  const patch: LeadProfilePatch = {}
  for (const [field, maxLength] of Object.entries(PROFILE_LIMITS)) {
    if (!Object.prototype.hasOwnProperty.call(input.profile, field)) continue
    const value = nullableText(input.profile[field], maxLength)
    if (value === undefined) return { ok: false, error: `Invalid ${field}` }
    patch[field as keyof typeof PROFILE_LIMITS] = value
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'At least one profile field is required' }
  }
  return { ok: true, patch }
}
