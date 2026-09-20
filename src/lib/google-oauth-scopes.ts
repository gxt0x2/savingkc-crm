export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'
export const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'
export const USERINFO_PROFILE_SCOPE = 'https://www.googleapis.com/auth/userinfo.profile'

/** Same grant requested by /api/auth/google/authorize. Do not downscope. */
export const REQUIRED_GOOGLE_OAUTH_SCOPES = [
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  GMAIL_MODIFY_SCOPE,
  CALENDAR_SCOPE,
  USERINFO_EMAIL_SCOPE,
  USERINFO_PROFILE_SCOPE,
] as const

const SCOPE_ALIASES: Record<string, string> = {
  'gmail.readonly': GMAIL_READONLY_SCOPE,
  'gmail.send': GMAIL_SEND_SCOPE,
  'gmail.modify': GMAIL_MODIFY_SCOPE,
  calendar: CALENDAR_SCOPE,
  'userinfo.email': USERINFO_EMAIL_SCOPE,
  'userinfo.profile': USERINFO_PROFILE_SCOPE,
  email: USERINFO_EMAIL_SCOPE,
  profile: USERINFO_PROFILE_SCOPE,
}

export function parseGoogleScopes(scope: string | null | undefined): string[] {
  if (!scope) return []
  return scope
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => SCOPE_ALIASES[value] || value)
}

export function hasGoogleScope(scope: string | null | undefined, required: string): boolean {
  const granted = parseGoogleScopes(scope)
  const needed = SCOPE_ALIASES[required] || required
  return granted.includes(needed)
}

export function missingGoogleScopes(
  scope: string | null | undefined,
  required: readonly string[] = REQUIRED_GOOGLE_OAUTH_SCOPES,
): string[] {
  return required.filter((needed) => !hasGoogleScope(scope, needed))
}

export function formatGoogleScopeLabel(scope: string): string {
  if (scope.endsWith('/gmail.send') || scope === 'gmail.send') return 'Gmail send'
  if (scope.endsWith('/gmail.readonly') || scope === 'gmail.readonly') return 'Gmail read'
  if (scope.endsWith('/gmail.modify') || scope === 'gmail.modify') return 'Gmail modify'
  if (scope.endsWith('/calendar') || scope === 'calendar') return 'Google Calendar'
  if (scope.endsWith('/userinfo.email') || scope === 'userinfo.email' || scope === 'email') return 'Email'
  if (scope.endsWith('/userinfo.profile') || scope === 'userinfo.profile' || scope === 'profile') return 'Profile'
  return scope.replace('https://www.googleapis.com/auth/', '')
}

export const GMAIL_SEND_ERROR_MESSAGES: Record<string, string> = {
  google_oauth_not_configured: 'Google OAuth is not configured in this environment.',
  no_token: 'Gmail is not connected. Connect Gmail in Settings, then try again.',
  missing_gmail_send: 'This Google account is missing Gmail send permission. Reconnect Gmail in Settings and approve send access.',
  missing_calendar: 'This Google account is missing Calendar permission. Reconnect Gmail in Settings and approve calendar access.',
  token_refresh_failed: 'Google rejected the saved token. Reconnect Gmail in Settings.',
  reauthorization_required: 'Google authorization expired. Reconnect Gmail in Settings.',
  gmail_send_failed: 'Gmail could not send the email.',
  invalid_recipient: 'Enter a valid email recipient.',
}

export function formatGmailSendError(code: string): string {
  return GMAIL_SEND_ERROR_MESSAGES[code] || code.replace(/_/g, ' ')
}
