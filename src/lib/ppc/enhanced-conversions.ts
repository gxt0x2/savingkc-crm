import { createHash } from 'node:crypto'

export type GoogleAdsUserIdentifier =
  | { userIdentifierSource: 'FIRST_PARTY'; hashedEmail: string }
  | { userIdentifierSource: 'FIRST_PARTY'; hashedPhoneNumber: string }

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// Google requires lowercase + trimmed before hashing.
function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  return trimmed.includes('@') ? trimmed : null
}

// Google requires E.164 before hashing.
function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('+')) {
    const digits = trimmed.replace(/\D/g, '')
    return digits.length >= 8 ? `+${digits}` : null
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** Build hashed identifiers to store at enqueue time. Returns [] when nothing usable. */
export function buildUserIdentifiers(input: {
  email?: string | null
  phone?: string | null
}): GoogleAdsUserIdentifier[] {
  const out: GoogleAdsUserIdentifier[] = []
  const email = normalizeEmail(input.email)
  if (email) out.push({ userIdentifierSource: 'FIRST_PARTY', hashedEmail: sha256Hex(email) })
  const phone = normalizePhoneE164(input.phone)
  if (phone) out.push({ userIdentifierSource: 'FIRST_PARTY', hashedPhoneNumber: sha256Hex(phone) })
  return out
}

/** Read identifiers back out of a stored payload/attribution object. */
export function readUserIdentifiers(
  source: Record<string, unknown> | null | undefined,
): GoogleAdsUserIdentifier[] {
  const raw = source?.user_identifiers
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is GoogleAdsUserIdentifier =>
      Boolean(item) &&
      typeof item === 'object' &&
      ('hashedEmail' in (item as object) || 'hashedPhoneNumber' in (item as object)),
  )
}
