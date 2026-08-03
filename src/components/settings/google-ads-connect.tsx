'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'

type GoogleAdsStatus = {
  oauthConfigured: boolean
  connected: boolean
  account: { user_email: string; created_at: string; scope: string } | null
  connectionStatus: 'connected' | 'reauthorization_required' | 'error' | 'disconnected'
  connectionErrorMessage: string | null
}

export function GoogleAdsConnect() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<GoogleAdsStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const success = searchParams.get('google_ads_oauth_success')
  const oauthError = searchParams.get('google_ads_oauth_error')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/auth/google-ads/status', { cache: 'no-store' })
      const data = await response.json()
      setStatus(response.ok ? data : null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, success])

  function connect() {
    const returnTo = `${window.location.pathname}${window.location.search}`
    window.location.href = `/api/auth/google-ads/authorize?${new URLSearchParams({ return_to: returnTo })}`
  }

  const needsReconnect = status?.connectionStatus === 'reauthorization_required'
  const buttonLabel = needsReconnect ? 'Reconnect Google Ads' : status?.connected ? 'Reconnect' : 'Connect Google Ads'

  return (
    <div className="ck-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--ck-text)] mb-1">Google Ads reporting</h2>
          <p className="text-[13px] text-[var(--ck-text-muted)]">
            Powers campaign spend, search-term reporting, and approved offline conversion uploads.
          </p>
        </div>
        <button
          type="button"
          onClick={connect}
          disabled={loading || status?.oauthConfigured === false}
          className="bg-[#E32E2E] hover:bg-[#c72626] text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Icon name="link" size="text-base" /> {buttonLabel}
        </button>
      </div>

      <div className="mt-4" aria-live="polite">
        {loading ? (
          <p className="text-sm text-[var(--ck-text-muted)]">Checking connection…</p>
        ) : needsReconnect ? (
          <div className="rounded-lg border border-red-400 bg-red-500/10 px-4 py-3 text-[13px] text-red-500">
            Authorization expired. Reconnect Google Ads to resume reporting and conversion exports.
          </div>
        ) : status?.connected ? (
          <div className="flex items-center gap-2 text-[13px] text-emerald-600">
            <Icon name="check_circle" size="text-base" /> Connected as {status.account?.user_email}
          </div>
        ) : (
          <div className="text-[13px] text-[var(--ck-text-muted)]">Google Ads is not connected.</div>
        )}
        {success ? <p className="mt-2 text-[13px] text-emerald-600">Connected {success}</p> : null}
        {oauthError ? (
          <p className="mt-2 text-[13px] text-red-500">
            Connection failed: {oauthError.replace(/_/g, ' ')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
