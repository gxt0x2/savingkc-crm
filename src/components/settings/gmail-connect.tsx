'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { isGmailSyncStale } from '@/lib/gmail-oauth-status'
import { formatGoogleScopeLabel } from '@/lib/google-oauth-scopes'

interface ConnectedAccount {
  user_email: string
  last_sync_at: string | null
  created_at: string
  scope: string
  missing_scopes?: string[]
  has_gmail_send?: boolean
  has_calendar?: boolean
  connection_status: 'connected' | 'reauthorization_required' | 'error'
  connection_error_code: string | null
  connection_error_message: string | null
  connection_checked_at: string | null
}

interface GmailConnectProps {
  userEmail?: string | null
}

export function GmailConnect({ userEmail }: GmailConnectProps) {
  const searchParams = useSearchParams()
  const normalizedUserEmail = userEmail?.trim().toLowerCase() || ''
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [oauthConfigured, setOauthConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const oauthSuccess = searchParams.get('oauth_success')
  const oauthError = searchParams.get('oauth_error')

  const load = useCallback(async () => {
    if (!normalizedUserEmail) {
      setAccounts([])
      setLoading(false)
      return
    }
    const params = new URLSearchParams({ user_email: normalizedUserEmail })
    const res = await fetch(`/api/auth/google/status?${params}`)
    const data = await res.json()
    setAccounts(data.accounts || [])
    setOauthConfigured(data.oauthConfigured !== false)
    setLoading(false)
  }, [normalizedUserEmail])

  useEffect(() => {
    load()
  }, [load])

  async function handleConnect() {
    if (!oauthConfigured) {
      setSyncResult('Gmail OAuth is not configured in Vercel yet.')
      return
    }
    const returnTo = `${window.location.pathname}${window.location.search}`
    const params = new URLSearchParams({ return_to: returnTo })
    // Full navigation is required so the browser follows the Google OAuth 302.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- OAuth authorize is a server 302, not an App Router page.
    window.location.assign(`${window.location.origin}/api/auth/google/authorize?${params}`)
  }

  async function handleDisconnect(email: string) {
    if (!confirm(`Disconnect Gmail for ${email}?`)) return
    await fetch('/api/auth/google/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_email: email }),
    })
    load()
  }

  async function handleSyncNow(email: string) {
    setSyncing(email)
    setSyncResult(null)
    try {
      const res = await fetch('/api/cron/sync-gmail/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: email, days_back: 30 }),
      })
      const data = await res.json()
      setSyncResult(
        data.error
          ? `Sync failed: ${formatGmailSyncError(data.error)}`
          : `Scanned ${data.scanned} emails · matched ${data.matched} · inserted ${data.inserted}`
      )
      load()
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(null)
    }
  }

  const disconnected = !loading && accounts.length === 0
  const showConnectButton = !loading && (accounts.length === 0 || !oauthConfigured)

  return (
    <section className="ck-card p-4 sm:p-5" aria-labelledby="gmail-settings-title">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--crm-brand-soft)] text-[var(--ck-accent)]">
          <MailGlyph />
        </span>
        <h2 id="gmail-settings-title" className="text-[17px] font-semibold tracking-tight text-[var(--ck-text)]">
          Gmail
        </h2>
      </div>
      {disconnected && (
        <p className="mt-3 text-[13px] leading-snug text-[var(--ck-text-muted)]">
          Sync mail and calendar with your @savingkc.com Google account.
        </p>
      )}

      {oauthSuccess && accounts.length === 0 && !loading && (
        <p className="mt-3 text-[13px] font-medium text-[var(--crm-success)]">Connected {oauthSuccess}</p>
      )}
      {oauthError && (
        <p role="alert" className="mt-3 text-[13px] text-[var(--crm-danger)]">
          {formatGmailSyncError(oauthError)}
        </p>
      )}
      {!oauthConfigured && (
        <p role="alert" className="mt-3 text-[13px] leading-snug text-[var(--crm-danger)]">
          Gmail OAuth is not configured in this environment. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, redeploy, then reconnect Gmail.
        </p>
      )}
      {showConnectButton && (
        <button
          type="button"
          onClick={handleConnect}
          disabled={!oauthConfigured}
          className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl bg-[var(--crm-brand)] px-4 text-sm font-semibold text-[var(--crm-on-brand)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          Connect Gmail
        </button>
      )}

      {loading ? (
        <p className="mt-3 text-sm text-[var(--ck-text-muted)]">Loading…</p>
      ) : accounts.length > 0 ? (
        <div className="mt-4 space-y-3 border-t border-[var(--ck-border)] pt-3">
          {accounts.map((account) => {
            const needsReconnect = account.connection_status === 'reauthorization_required'
            const isError = account.connection_status === 'error' || !oauthConfigured
            const isUnhealthy = needsReconnect || isError
            const staleSync = account.connection_status === 'connected' && isGmailSyncStale(account.last_sync_at)
            const calendarOn = account.connection_status === 'connected'
              && oauthConfigured
              && Boolean(account.has_calendar || (account.scope || '').includes('calendar'))
            const statusLabel = !oauthConfigured
              ? 'OAuth is not configured — this account is not connected'
              : needsReconnect
                ? 'Authorization expired — reconnect Gmail'
                : account.connection_status === 'error'
                  ? (account.connection_error_message || 'Gmail connection error — reconnect')
                  : 'Connected'

            return (
              <div key={account.user_email} className="min-w-0">
                <p className={`flex items-center gap-1.5 text-[13px] font-semibold ${isUnhealthy ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-success)]'}`}>
                  {!isUnhealthy && <CheckGlyph />}
                  {statusLabel}
                </p>
                <p className="truncate text-[15px] font-semibold text-[var(--ck-text)]">{account.user_email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {!isUnhealthy && (
                    <span className="text-[13px] text-[var(--ck-text-muted)]">{formatSyncAge(account.last_sync_at)}</span>
                  )}
                  {oauthConfigured && (
                    <button
                      type="button"
                      onClick={() => isUnhealthy ? handleConnect() : handleSyncNow(account.user_email)}
                      disabled={syncing === account.user_email}
                      className={`text-[13px] font-semibold hover:underline disabled:opacity-50 ${isUnhealthy ? 'text-[var(--crm-danger)]' : 'text-[var(--ck-accent)]'}`}
                    >
                      {isUnhealthy ? 'Reconnect Gmail' : syncing === account.user_email ? 'Syncing…' : 'Sync now'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDisconnect(account.user_email)}
                    className="text-[13px] font-medium text-[var(--crm-danger)] hover:underline"
                  >
                    Disconnect
                  </button>
                </div>
                {calendarOn && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--ck-text-muted)]">
                    <CalendarGlyph />
                    Calendar sync on
                  </p>
                )}
                {staleSync && (
                  <p className="mt-1.5 text-[12px] leading-snug text-[var(--crm-warning)]">
                    Last sync is more than 36 hours old. Daily Gmail poll may be stalled — do not treat this as a live sync.
                  </p>
                )}
                {account.connection_status === 'connected' && (account.missing_scopes?.length || 0) > 0 && (
                  <p className="mt-1.5 text-[12px] leading-snug text-[var(--crm-warning)]">
                    Missing after reconnect: {account.missing_scopes!.map(formatGoogleScopeLabel).join(', ')}. Reconnect Gmail and approve every requested permission.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      {syncResult && (
        <p role="status" className="mt-3 text-[13px] text-[var(--ck-text)]">{syncResult}</p>
      )}
    </section>
  )
}

function formatSyncAge(lastSyncAt: string | null): string {
  if (!lastSyncAt) return 'Never synced'
  const then = new Date(lastSyncAt).getTime()
  if (Number.isNaN(then)) return 'Never synced'
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 14) return `${days}d ago`
  return new Date(lastSyncAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function MailGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </svg>
  )
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5L20 7" />
    </svg>
  )
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3.5v3M16 3.5v3M4 9.5h16" />
    </svg>
  )
}

function formatGmailSyncError(error: string): string {
  const labels: Record<string, string> = {
    google_oauth_not_configured: 'Google OAuth is not configured in Vercel.',
    token_refresh_failed: 'Google rejected the saved token. Reconnect Gmail.',
    reauthorization_required: 'Google authorization expired. Reconnect Gmail to resume syncing.',
    missing_refresh_token: 'No Google refresh token is stored. Reconnect Gmail.',
    connection_unverified: 'Gmail connection has not been verified. Reconnect if this persists.',
    no_token: 'No Gmail token is connected for this account.',
    no_refresh_token_revoke_and_retry: 'Google did not return a refresh token. Remove SavingKC CRM from your Google account permissions, then reconnect.',
    token_exchange_failed: 'Google token exchange failed. Check the OAuth client and redirect URI.',
    storage_failed: 'The Gmail token could not be saved.',
    no_email: 'Google did not return an email address.',
    unauthorized: 'Sign in to Saving KC CRM before connecting Gmail.',
  }

  return labels[error] || error.replace(/_/g, ' ')
}
