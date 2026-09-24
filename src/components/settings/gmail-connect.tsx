'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { isGmailSyncStale } from '@/lib/gmail-oauth-status'
import { formatGoogleScopeLabel, formatGmailSendError } from '@/lib/google-oauth-scopes'

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
  const [sendTo, setSendTo] = useState('')
  const [sendSubject, setSendSubject] = useState('Saving KC Gmail test')
  const [sendBody, setSendBody] = useState('This message was sent from Saving KC CRM through the connected Gmail account.')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

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

  async function handleSendGmail() {
    setSending(true)
    setSendError(null)
    setSendResult(null)
    try {
      const res = await fetch('/api/auth/google/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: normalizedUserEmail || undefined,
          to: sendTo.trim(),
          subject: sendSubject.trim() || 'Message from Saving KC',
          body: sendBody.trim(),
        }),
      })
      const data = await res.json() as { error?: string; code?: string; id?: string }
      if (!res.ok) {
        throw new Error(data.error || (data.code ? formatGmailSendError(data.code) : 'Gmail send failed'))
      }
      setSendResult(`Sent through Gmail${data.id ? ` · ${data.id}` : ''}`)
      setSendBody('')
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Gmail send failed')
    } finally {
      setSending(false)
    }
  }

  const connectedAccount = accounts.find((account) => account.connection_status === 'connected')
  const calendarSyncOn = Boolean(connectedAccount && (connectedAccount.has_calendar ?? true) && oauthConfigured)

  return (
    <div className="ck-card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--ck-text)] mb-1">Gmail Sync</h2>
          <p className="text-[13px] text-[var(--ck-text-muted)]">
            Connect Gmail to sync inbound threads, send from your Google account, and write your CRM appointments to Google Calendar.
          </p>
        </div>
        <button
          onClick={handleConnect}
          disabled={!oauthConfigured}
          className="bg-[#E32E2E] hover:bg-[#c72626] text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <Icon name="add" size="text-base" /> Connect Gmail
        </button>
      </div>
      <p className="text-[12px] text-[var(--ck-text-muted)] mb-4">
        Connecting Gmail lets Saving KC CRM read matched inbox threads, send from your Google account, and write CRM appointments to Google Calendar. We do not sell Google user data or use it for ads.{' '}
        <Link href="/privacy" className="underline text-[var(--ck-accent)]">
          Privacy Policy
        </Link>
        {' '}explains access, storage, and Google Limited Use. Disconnect stops further Google API access and removes stored OAuth tokens.
      </p>

      {/* OAuth feedback banners */}
      {oauthSuccess && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[13px] rounded-lg px-4 py-3">
          ✓ Connected {oauthSuccess}
        </div>
      )}
      {oauthError && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 text-[13px] rounded-lg px-4 py-3">
          Error: {formatGmailSyncError(oauthError)}
        </div>
      )}
      {!oauthConfigured && (
        <div className="mb-4 bg-red-500/10 border border-red-400 text-red-500 text-[13px] rounded-lg px-4 py-3">
          Gmail OAuth is not configured in this environment. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, redeploy, then reconnect Gmail. Existing accounts are not healthy.
        </div>
      )}
      {syncResult && (
        <div className="mb-4 bg-sky-500/10 border border-sky-500/30 text-sky-400 text-[13px] rounded-lg px-4 py-3">
          {syncResult}
        </div>
      )}

      {/* Connected accounts */}
      {loading ? (
        <p className="text-sm text-[var(--ck-text-muted)]">Loading…</p>
      ) : accounts.length === 0 ? (
        <div className="text-center py-8 text-sm text-[var(--ck-text-muted)]">
          <Icon name="mail" size="text-3xl" className="text-[var(--ck-text-dim)] mb-2 block mx-auto" />
          {normalizedUserEmail ? `No Gmail connected for ${normalizedUserEmail}` : 'No Gmail accounts connected yet'}
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map(a => {
            const needsReconnect = a.connection_status === 'reauthorization_required'
            const isError = a.connection_status === 'error' || !oauthConfigured
            const isUnhealthy = needsReconnect || isError
            const staleSync = a.connection_status === 'connected' && isGmailSyncStale(a.last_sync_at)
            return (
              <div
                key={a.user_email}
                className={`flex items-center justify-between p-3 rounded-lg bg-[var(--ck-surface-elev)] border ${isUnhealthy ? 'border-red-400' : staleSync ? 'border-amber-400' : 'border-[var(--ck-border)]'}`}
              >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isUnhealthy ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
                  <Icon name="mail" size="text-base" className={isUnhealthy ? 'text-red-500' : 'text-emerald-400'} />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[var(--ck-text)] truncate">{a.user_email}</p>
                  <p className={`text-[11px] ${isUnhealthy ? 'text-red-500' : 'text-[var(--ck-text-muted)]'}`}>
                    {!oauthConfigured
                      ? 'OAuth is not configured — this account is not connected'
                      : needsReconnect
                      ? 'Authorization expired — reconnect Gmail'
                      : a.connection_status === 'error'
                      ? (a.connection_error_message || 'Gmail connection error — reconnect')
                      : a.last_sync_at
                      ? `Last sync: ${new Date(a.last_sync_at).toLocaleString()}`
                      : 'Never synced'}
                  </p>
                  {staleSync && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-300">
                      Last sync is more than 36 hours old. Daily Gmail poll may be stalled — do not treat this as a live sync.
                    </p>
                  )}
                  {a.connection_status === 'connected' && (a.has_calendar || (a.scope || '').includes('calendar')) && (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-300">
                      Google Calendar sync is on — appointments you create are written to this Google account.
                    </p>
                  )}
                  {a.connection_status === 'connected' && (a.missing_scopes?.length || 0) > 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-300">
                      Missing after reconnect: {a.missing_scopes!.map(formatGoogleScopeLabel).join(', ')}. Reconnect Gmail and approve every requested permission.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => isUnhealthy ? handleConnect() : handleSyncNow(a.user_email)}
                  disabled={syncing === a.user_email || !oauthConfigured}
                  className={`text-[12px] font-semibold hover:underline disabled:opacity-50 ${isUnhealthy ? 'text-red-500' : 'text-[var(--ck-accent)]'}`}
                >
                  {isUnhealthy ? 'Reconnect Gmail' : syncing === a.user_email ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  onClick={() => handleDisconnect(a.user_email)}
                  className="text-[12px] font-medium text-red-400 hover:underline"
                >
                  Disconnect
                </button>
              </div>
              </div>
            )
          })}
        </div>
      )}

      {connectedAccount && (
        <div className="mt-5 border-t border-[var(--ck-border)] pt-4">
          <h3 className="text-sm font-bold text-[var(--ck-text)] mb-1">Send via Gmail</h3>
          <p className="text-[12px] text-[var(--ck-text-muted)] mb-3">
            Sends through Gmail API using {connectedAccount.user_email}. This is the connected Google mailbox, not Resend.
          </p>
          {calendarSyncOn && (
            <p className="text-[12px] text-emerald-600 dark:text-emerald-300 mb-3">
              Google Calendar sync is on for this connection.
            </p>
          )}
          <div className="space-y-2">
            <input
              aria-label="Gmail recipient"
              type="email"
              value={sendTo}
              onChange={(event) => setSendTo(event.target.value)}
              placeholder="Recipient email"
              className="w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm text-[var(--ck-text)]"
            />
            <input
              aria-label="Gmail subject"
              value={sendSubject}
              onChange={(event) => setSendSubject(event.target.value)}
              placeholder="Subject"
              className="w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm text-[var(--ck-text)]"
            />
            <textarea
              aria-label="Gmail message"
              value={sendBody}
              onChange={(event) => setSendBody(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm text-[var(--ck-text)]"
            />
            {sendError && <p role="alert" className="text-[12px] font-medium text-red-500">{sendError}</p>}
            {sendResult && <p role="status" className="text-[12px] font-medium text-emerald-500">{sendResult}</p>}
            <button
              type="button"
              onClick={handleSendGmail}
              disabled={sending || !sendTo.trim() || !sendBody.trim() || !oauthConfigured}
              className="bg-[#E32E2E] hover:bg-[#c72626] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              {sending ? 'Sending…' : 'Send via Gmail'}
            </button>
          </div>
        </div>
      )}
    </div>
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
