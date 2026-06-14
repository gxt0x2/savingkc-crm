/**
 * Formatting utilities — Night 7
 * FIX-02: toProperCase() — Title Case for lead names
 * FIX-03: formatPhone() — (XXX) XXX-XXXX formatting
 */

// Words that should stay lowercase (unless first word)
const LOWERCASE_WORDS = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'to', 'for', 'by'])

// Special casing patterns
const SPECIAL_CASES: Record<string, string> = {
  mcdonald: 'McDonald',
  macdonald: 'MacDonald',
  macarthur: 'MacArthur',
}

/**
 * Collapse labels like "Google Ads Caller ((816) 555-1212)" to
 * "Google Ads Caller (816) 555-1212".
 */
export function normalizePhoneDisplayText(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/\(\((\d{3})\)\s*(\d{3})-(\d{4})\)/g, '($1) $2-$3')
}

/**
 * Convert a name to proper/title case.
 * Handles: McDonald, O'Brien, hyphenated names, etc.
 */
export function toProperCase(name: string | null | undefined): string {
  if (!name) return ''
  
  return normalizePhoneDisplayText(name)
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase()

      if (index > 0 && LOWERCASE_WORDS.has(lower)) return lower
      
      // Check special cases
      if (SPECIAL_CASES[lower]) return SPECIAL_CASES[lower]
      
      // Handle O'Brien, D'Angelo type names
      if (lower.length > 2 && (lower[1] === "'" || lower[1] === '\u2019')) {
        return lower[0].toUpperCase() + "'" + lower[2].toUpperCase() + lower.slice(3)
      }
      
      // Handle hyphenated names like Smith-Jones
      if (lower.includes('-')) {
        return lower.split('-').map(part => 
          part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        ).join('-')
      }
      
      // Handle Mc prefix (McBride, McCallister)
      if (lower.startsWith('mc') && lower.length > 2) {
        return 'Mc' + lower.charAt(2).toUpperCase() + lower.slice(3)
      }
      
      // Regular capitalization
      return lower.charAt(0).toUpperCase() + lower.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * Format a phone number to (XXX) XXX-XXXX
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  
  // Strip all non-digits
  const digits = phone.replace(/\D/g, '')
  
  // Handle 10-digit numbers
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  
  // Handle 11-digit numbers starting with 1 (US country code)
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  
  // Return original if can't format
  return phone
}
