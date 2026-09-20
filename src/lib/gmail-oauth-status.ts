import type { OAuthConnectionStatus, OAuthHealth } from '@/lib/oauth-health'
import { missingGoogleScopes } from '@/lib/google-oauth-scopes'

export const GMAIL_STALE_SYNC_MS = 36 * 60 * 60 * 1000

export type GoogleConnectionStatus = OAuthConnectionStatus
export type GmailAndonStatus = 'healthy' | 'attention' | 'down' | 'not_configured' | 'disconnected'

export type GoogleProbeResult = {
  ok: boolean
  errorCode: string | null
  errorMessage: string | null
}

export type ResolvedGoogleConnection = {
  connection_status: GoogleConnectionStatus
  connection_error_code: string | null
  connection_error_message: string | null
  connection_checked_at: string | null
  shouldProbe: boolean
  persist: {
    status: GoogleConnectionStatus
    errorCode: string | null
    errorMessage: string | null
  } | null
}

export type GoogleStatusAccount = {
  user_email: string
  last_sync_at: string | null
  created_at: string
  scope: string
  missing_scopes: string[]
  has_gmail_send: boolean
  has_calendar: boolean
  connection_status: GoogleConnectionStatus
  connection_error_code: string | null
  connection_error_message: string | null
  connection_checked_at: string | null
}

export type GmailHealthAccount = {
  userEmail: string
  status: GoogleConnectionStatus
  lastSyncAt: string | null
  errorCode: string | null
  staleSync: boolean
  missingScopes: string[]
}

export type GmailHealthSnapshot = {
  oauthConfigured: boolean
  status: GmailAndonStatus
  lastSyncAt: string | null
  errorCode: string | null
  accounts: GmailHealthAccount[]
}

type HealthSlice = Pick<OAuthHealth, 'status' | 'errorCode' | 'errorMessage' | 'checkedAt'>

const NOT_CONFIGURED_MESSAGE = 'Google OAuth is not configured in this environment.'
const UNVERIFIED_MESSAGE = 'Gmail connection has not been verified.'
const MISSING_REFRESH_MESSAGE = 'No Google refresh token is stored. Reconnect Gmail.'
const REAUTH_MESSAGE = 'Google authorization expired. Reconnect Gmail.'

export function hasNonEmptyRefreshToken(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function isGmailSyncStale(lastSyncAt: string | null | undefined, now: Date | number = Date.now()): boolean {
  if (!lastSyncAt) return false
  const timestamp = new Date(lastSyncAt).getTime()
  if (!Number.isFinite(timestamp)) return true
  const nowMs = typeof now === 'number' ? now : now.getTime()
  return nowMs - timestamp > GMAIL_STALE_SYNC_MS
}

export function isInvalidGrantError(errorCode: string | null | undefined): boolean {
  return errorCode === 'invalid_grant' || errorCode === 'reauthorization_required'
}

export function resolveGoogleAccountConnection(input: {
  oauthConfigured: boolean
  hasRefreshToken: boolean
  health: HealthSlice | null
  probe?: GoogleProbeResult | null
  now?: string
}): ResolvedGoogleConnection {
  const checkedAt = input.now || input.health?.checkedAt || null

  if (!input.oauthConfigured) {
    return {
      connection_status: 'error',
      connection_error_code: 'google_oauth_not_configured',
      connection_error_message: NOT_CONFIGURED_MESSAGE,
      connection_checked_at: checkedAt,
      shouldProbe: false,
      persist: null,
    }
  }

  if (!input.hasRefreshToken) {
    return {
      connection_status: 'reauthorization_required',
      connection_error_code: 'missing_refresh_token',
      connection_error_message: MISSING_REFRESH_MESSAGE,
      connection_checked_at: checkedAt,
      shouldProbe: false,
      persist: input.health?.status === 'reauthorization_required' && input.health.errorCode === 'missing_refresh_token'
        ? null
        : { status: 'reauthorization_required', errorCode: 'missing_refresh_token', errorMessage: MISSING_REFRESH_MESSAGE },
    }
  }

  if (input.health?.status === 'connected') {
    return {
      connection_status: 'connected',
      connection_error_code: null,
      connection_error_message: null,
      connection_checked_at: input.health.checkedAt,
      shouldProbe: false,
      persist: null,
    }
  }

  if (input.health?.status === 'reauthorization_required') {
    return {
      connection_status: 'reauthorization_required',
      connection_error_code: input.health.errorCode || 'invalid_grant',
      connection_error_message: input.health.errorMessage || REAUTH_MESSAGE,
      connection_checked_at: input.health.checkedAt,
      shouldProbe: false,
      persist: null,
    }
  }

  if (!input.probe) {
    return {
      connection_status: 'error',
      connection_error_code: input.health?.errorCode || 'connection_unverified',
      connection_error_message: input.health?.errorMessage || UNVERIFIED_MESSAGE,
      connection_checked_at: input.health?.checkedAt || null,
      shouldProbe: true,
      persist: null,
    }
  }

  if (input.probe.ok) {
    return {
      connection_status: 'connected',
      connection_error_code: null,
      connection_error_message: null,
      connection_checked_at: input.now || new Date().toISOString(),
      shouldProbe: false,
      persist: { status: 'connected', errorCode: null, errorMessage: null },
    }
  }

  const errorCode = input.probe.errorCode || 'token_refresh_failed'
  const reauthorizationRequired = isInvalidGrantError(errorCode)
  const errorMessage = input.probe.errorMessage || (reauthorizationRequired ? REAUTH_MESSAGE : 'Gmail connection check failed.')
  return {
    connection_status: reauthorizationRequired ? 'reauthorization_required' : 'error',
    connection_error_code: errorCode,
    connection_error_message: errorMessage,
    connection_checked_at: input.now || new Date().toISOString(),
    shouldProbe: false,
    persist: {
      status: reauthorizationRequired ? 'reauthorization_required' : 'error',
      errorCode,
      errorMessage,
    },
  }
}

export function mapGmailHealthSnapshot(input: {
  oauthConfigured: boolean
  accounts: Array<{
    userEmail: string
    hasRefreshToken: boolean
    lastSyncAt: string | null
    health: HealthSlice | null
    scope?: string | null
  }>
  now?: Date | number
}): GmailHealthSnapshot {
  const accounts = input.accounts.map((account) => {
    const resolved = resolveGoogleAccountConnection({
      oauthConfigured: input.oauthConfigured,
      hasRefreshToken: account.hasRefreshToken,
      health: account.health,
      probe: null,
    })
    const missingScopes = missingGoogleScopes(account.scope)
    return {
      userEmail: account.userEmail,
      status: resolved.connection_status,
      lastSyncAt: account.lastSyncAt,
      errorCode: resolved.connection_error_code,
      staleSync: resolved.connection_status === 'connected' && isGmailSyncStale(account.lastSyncAt, input.now),
      missingScopes,
    }
  })

  const lastSyncAt = accounts
    .map((account) => account.lastSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] || null

  if (!input.oauthConfigured) {
    return {
      oauthConfigured: false,
      status: 'not_configured',
      lastSyncAt,
      errorCode: 'google_oauth_not_configured',
      accounts,
    }
  }

  if (accounts.length === 0) {
    return { oauthConfigured: true, status: 'disconnected', lastSyncAt: null, errorCode: null, accounts }
  }

  const unhealthy = accounts.find((account) => account.status !== 'connected')
  if (unhealthy) {
    return {
      oauthConfigured: true,
      status: 'down',
      lastSyncAt,
      errorCode: unhealthy.errorCode,
      accounts,
    }
  }

  if (accounts.some((account) => account.staleSync)) {
    return { oauthConfigured: true, status: 'attention', lastSyncAt, errorCode: 'stale_sync', accounts }
  }

  if (accounts.some((account) => account.missingScopes.length > 0)) {
    return { oauthConfigured: true, status: 'attention', lastSyncAt, errorCode: 'missing_scopes', accounts }
  }

  return { oauthConfigured: true, status: 'healthy', lastSyncAt, errorCode: null, accounts }
}
