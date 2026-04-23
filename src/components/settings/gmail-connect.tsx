'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'

interface ConnectedAccount {
  user_email: string
  last_sync_at: string | null
  created_at: string
  scope: string
}

export function GmailConnect() {
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const oauthSuccess = searchParams.get('oauth_success')
  const oauthError = searchParams.get('oauth_error')

  const load = useCallback(async () => {
    const res = await fetch('/api/auth/google/status')
    const data = await res.json()
    setAccounts(data.accounts || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleConnect() {
    window.location.href = '/api/auth/google/authorize?return_to=/settings'
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
          ? `Sync failed: ${data.error}`
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
            Connect your Gmail to automatically sync email threads with leads. Sync runs every 5 minutes.
          </p>
        </div>
        <button
          onClick={handleConnect}
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
          Error: {oauthError.replace(/_/g, ' ')}
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
          No Gmail accounts connected yet
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map(a => (
            <div
              key={a.user_email}
              className="flex items-center justify-between p-3 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                  <Icon name="mail" size="text-base" className="text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[var(--ck-text)] truncate">{a.user_email}</p>
                  <p className="text-[11px] text-[var(--ck-text-muted)]">
                    {a.last_sync_at
                      ? `Last sync: ${new Date(a.last_sync_at).toLocaleString()}`
                      : 'Never synced'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleSyncNow(a.user_email)}
                  disabled={syncing === a.user_email}
                  className="text-[12px] font-medium text-[var(--ck-accent)] hover:underline disabled:opacity-50"
                >
                  {syncing === a.user_email ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  onClick={() => handleDisconnect(a.user_email)}
                  className="text-[12px] font-medium text-red-400 hover:underline"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
