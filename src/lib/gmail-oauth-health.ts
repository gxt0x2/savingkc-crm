import type { SupabaseClient } from '@supabase/supabase-js'
import { hasGoogleOAuthConfig, getValidAccessTokenResult, type StoredToken } from '@/lib/gmail-sync'
import { persistOAuthHealth, readOAuthHealth } from '@/lib/oauth-health'
import {
  hasNonEmptyRefreshToken,
  mapGmailHealthSnapshot,
  resolveGoogleAccountConnection,
  type GmailHealthSnapshot,
  type GoogleProbeResult,
  type GoogleStatusAccount,
} from '@/lib/gmail-oauth-status'

const REAUTH_MESSAGE = 'Google authorization expired. Reconnect Gmail.'

export async function probeGoogleGmailGrant(token: StoredToken): Promise<GoogleProbeResult> {
  const tokenResult = await getValidAccessTokenResult(token)
  if (!tokenResult.accessToken) {
    return {
      ok: false,
      errorCode: tokenResult.error,
      errorMessage: tokenResult.error === 'reauthorization_required' ? REAUTH_MESSAGE : tokenResult.error,
    }
  }

  const headers = { Authorization: `Bearer ${tokenResult.accessToken}` }
  const userinfo = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers })
  if (userinfo.ok) return { ok: true, errorCode: null, errorMessage: null }

  const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers })
  if (profile.ok) return { ok: true, errorCode: null, errorMessage: null }

  const failed = userinfo.status <= profile.status ? userinfo : profile
  const body = await failed.json().catch(() => ({})) as { error?: string; error_description?: string }
  return {
    ok: false,
    errorCode: body.error || `oauth_http_${failed.status}`,
    errorMessage: body.error_description || 'Google grant probe failed.',
  }
}

export async function evaluateGoogleAccounts(input: {
  db: SupabaseClient
  accounts: Array<{
    user_email: string
    last_sync_at: string | null
    created_at: string
    scope?: string | null
    refresh_token?: string | null
    access_token?: string | null
    expires_at?: string | null
    id?: string
  }>
  oauthConfigured?: boolean
  now?: string
  readHealth?: typeof readOAuthHealth
  probe?: (token: StoredToken) => Promise<GoogleProbeResult>
  persist?: typeof persistOAuthHealth
}): Promise<GoogleStatusAccount[]> {
  const oauthConfigured = input.oauthConfigured ?? hasGoogleOAuthConfig()
  const readHealth = input.readHealth || readOAuthHealth
  const probe = input.probe || probeGoogleGmailGrant
  const persist = input.persist || persistOAuthHealth

  return Promise.all(input.accounts.map(async (account) => {
    const health = await readHealth(input.db, 'google', account.user_email)
    const hasRefreshToken = hasNonEmptyRefreshToken(account.refresh_token)
    let resolved = resolveGoogleAccountConnection({
      oauthConfigured,
      hasRefreshToken,
      health,
      probe: null,
      now: input.now,
    })

    if (resolved.shouldProbe && account.id && hasRefreshToken) {
      const probeResult = await probe({
        id: account.id,
        user_email: account.user_email,
        access_token: account.access_token || null,
        refresh_token: account.refresh_token!.trim(),
        expires_at: account.expires_at || null,
        last_sync_at: account.last_sync_at,
      })
      resolved = resolveGoogleAccountConnection({
        oauthConfigured,
        hasRefreshToken,
        health,
        probe: probeResult,
        now: input.now,
      })
    }

    if (resolved.persist) {
      await persist(input.db, {
        provider: 'google',
        userEmail: account.user_email,
        status: resolved.persist.status,
        errorCode: resolved.persist.errorCode,
        errorMessage: resolved.persist.errorMessage,
        checkedAt: resolved.connection_checked_at || undefined,
      })
    }

    return {
      user_email: account.user_email,
      last_sync_at: account.last_sync_at,
      created_at: account.created_at,
      scope: account.scope || '',
      connection_status: resolved.connection_status,
      connection_error_code: resolved.connection_error_code,
      connection_error_message: resolved.connection_error_message,
      connection_checked_at: resolved.connection_checked_at,
    }
  }))
}

export async function readGmailConnectionHealth(
  db: SupabaseClient,
  options?: { now?: Date | number },
): Promise<GmailHealthSnapshot> {
  const oauthConfigured = hasGoogleOAuthConfig()
  const { data, error } = await db
    .from('user_oauth_tokens')
    .select('user_email, last_sync_at, refresh_token')
    .eq('provider', 'google')
    .order('created_at', { ascending: false })

  if (error) {
    return {
      oauthConfigured,
      status: oauthConfigured ? 'down' : 'not_configured',
      lastSyncAt: null,
      errorCode: 'health_lookup_failed',
      accounts: [],
    }
  }

  const accounts = await Promise.all((data || []).map(async (row) => ({
    userEmail: String(row.user_email || ''),
    hasRefreshToken: hasNonEmptyRefreshToken(row.refresh_token),
    lastSyncAt: typeof row.last_sync_at === 'string' ? row.last_sync_at : null,
    health: String(row.user_email || '') ? await readOAuthHealth(db, 'google', String(row.user_email)) : null,
  })))

  return mapGmailHealthSnapshot({
    oauthConfigured,
    accounts: accounts.filter((account) => account.userEmail),
    now: options?.now,
  })
}
