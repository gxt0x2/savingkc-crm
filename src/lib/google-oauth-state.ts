export type GoogleOAuthProvider = 'google' | 'google_ads'

export type GoogleOAuthState = {
  returnTo: string
  provider: GoogleOAuthProvider
  crmEmail: string | null
}

function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/settings'
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.includes('@') ? email : null
}

/** OAuth state carries the CRM login that started consent. The callback still prefers the live session. */
export function encodeGoogleOAuthState(input: {
  returnTo?: string | null
  provider?: GoogleOAuthProvider | null
  crmEmail?: string | null
}): string {
  const payload: Record<string, string> = { return_to: safeReturnTo(input.returnTo) }
  if (input.provider === 'google_ads') payload.provider = 'google_ads'
  const crmEmail = normalizeEmail(input.crmEmail)
  if (crmEmail) payload.crm_email = crmEmail
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeGoogleOAuthState(state: string | null): GoogleOAuthState {
  try {
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString()) as Record<string, unknown>
      return {
        returnTo: safeReturnTo(decoded.return_to),
        provider: decoded.provider === 'google_ads' ? 'google_ads' : 'google',
        crmEmail: normalizeEmail(decoded.crm_email),
      }
    }
  } catch { /* ignore malformed state */ }
  return { returnTo: '/settings', provider: 'google', crmEmail: null }
}

/**
 * The Google mailbox is stored on user_email. crm_user_email is the CRM login
 * that connected it. A missing session must not clear an existing link.
 */
export function crmEmailForConnectedGoogleAccount(input: {
  sessionEmail?: string | null
  stateCrmEmail?: string | null
}): string | null {
  return normalizeEmail(input.sessionEmail) || normalizeEmail(input.stateCrmEmail)
}
