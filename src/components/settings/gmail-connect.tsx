'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'

interface ConnectedAccount {
  user_email: string
  last_sync_at: string | null
  created_at: string
  scope: string
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
    window.location.href = `/api/auth/google/authorize?${params}`
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

  return (
    <div className="ck-card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--ck-text)] mb-1">Gmail Sync</h2>
          <p className="text-[13px] text-[var(--ck-text-muted)]">
            Connect your Gmail to automatically sync email threads with leads. Sync runs daily; use Sync now for immediate updates.
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
        <div className="mb-4 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[13px] rounded-lg px-4 py-3">
          Gmail OAuth is not configured in Vercel. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, redeploy, then reconnect Gmail.
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
            return (
              <div
                key={a.user_email}
                className={`flex items-center justify-between p-3 rounded-lg bg-[var(--ck-surface-elev)] border ${needsReconnect ? 'border-red-400' : 'border-[var(--ck-border)]'}`}
              >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                  <Icon name="mail" size="text-base" className="text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[var(--ck-text)] truncate">{a.user_email}</p>
                  <p className="text-[11px] text-[var(--ck-text-muted)]">
                    {needsReconnect
                      ? 'Authorization expired — reconnect to resume automatic sync'
                      : a.last_sync_at
                      ? `Last sync: ${new Date(a.last_sync_at).toLocaleString()}`
                      : 'Never synced'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => needsReconnect ? handleConnect() : handleSyncNow(a.user_email)}
                  disabled={syncing === a.user_email || !oauthConfigured}
                  className={`text-[12px] font-semibold hover:underline disabled:opacity-50 ${needsReconnect ? 'text-red-500' : 'text-[var(--ck-accent)]'}`}
                >
                  {needsReconnect ? 'Reconnect Gmail' : syncing === a.user_email ? 'Syncing…' : 'Sync now'}
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
    </div>
  )
}

function formatGmailSyncError(error: string): string {
  const labels: Record<string, string> = {
    google_oauth_not_configured: 'Google OAuth is not configured in Vercel.',
    token_refresh_failed: 'Google rejected the saved token. Reconnect Gmail.',
    reauthorization_required: 'Google authorization expired. Reconnect Gmail to resume syncing.',
    no_token: 'No Gmail token is connected for this account.',
    no_refresh_token_revoke_and_retry: 'Google did not return a refresh token. Remove SavingKC CRM from your Google account permissions, then reconnect.',
    token_exchange_failed: 'Google token exchange failed. Check the OAuth client and redirect URI.',
    storage_failed: 'The Gmail token could not be saved.',
    no_email: 'Google did not return an email address.',
  }

  return labels[error] || error.replace(/_/g, ' ')
}
