export type GoogleAdsLeadsUserData = {
  sha256_email_address?: string
  sha256_phone_number?: string
}

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeEmail(raw: string | null | undefined): string | null {
  const value = text(raw)?.toLowerCase()
  return value?.includes('@') ? value : null
}

function normalizePhoneE164(raw: string | null | undefined): string | null {
  const value = text(raw)
  if (!value) return null

  if (value.startsWith('+')) {
    const digits = value.replace(/\D/g, '')
    return digits.length >= 8 ? `+${digits}` : null
  }

  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return bytesToHex(new Uint8Array(digest))
}

/**
 * GTM enhanced conversions for leads can read this object from the dataLayer.
 * Keep it pre-hashed so raw contact data never enters analytics payloads.
 */
export async function buildGoogleAdsLeadsUserData(input: {
  email?: string | null
  phone?: string | null
}): Promise<GoogleAdsLeadsUserData | null> {
  const email = normalizeEmail(input.email)
  const phone = normalizePhoneE164(input.phone)
  const [hashedEmail, hashedPhone] = await Promise.all([
    email ? sha256Hex(email) : Promise.resolve(null),
    phone ? sha256Hex(phone) : Promise.resolve(null),
  ])

  const userData: GoogleAdsLeadsUserData = {
    ...(hashedEmail ? { sha256_email_address: hashedEmail } : {}),
    ...(hashedPhone ? { sha256_phone_number: hashedPhone } : {}),
  }

  return Object.keys(userData).length > 0 ? userData : null
}
