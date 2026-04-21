/**
 * Normalize raw phone values (dashes, parens, dots, floats) to E.164 format.
 * Returns +1XXXXXXXXXX or null if invalid.
 */
export function normalizePhoneToE164(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null

  // Handle Excel float phone numbers (e.g. 8163086775.0)
  let str: string
  if (typeof raw === 'number') {
    str = Math.round(raw).toString()
  } else {
    str = raw.toString().trim()
  }

  // Strip everything except digits
  const digits = str.replace(/\D/g, '')

  // 10-digit US number
  if (digits.length === 10) {
    return `+1${digits}`
  }

  // 11-digit with leading 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1${digits.slice(1)}`
  }

  return null
}
