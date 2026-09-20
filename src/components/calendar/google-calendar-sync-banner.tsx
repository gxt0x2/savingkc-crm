'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export function GoogleCalendarSyncBanner() {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/auth/google/status', { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as {
          oauthConfigured?: boolean
          accounts?: Array<{
            connection_status?: string
            has_calendar?: boolean
            missing_scopes?: string[]
          }>
        }
        const account = data.accounts?.[0]
        if (!response.ok || !account) {
          setLabel(null)
          return
        }
        if (account.connection_status === 'connected' && (account.has_calendar || data.oauthConfigured)) {
          setLabel('Google Calendar sync is on. Appointments you create are written to your primary Google Calendar.')
          return
        }
        if ((account.missing_scopes || []).some((scope) => scope.includes('calendar'))) {
          setLabel('Google Calendar write is off until you reconnect Gmail and approve calendar access.')
          return
        }
        setLabel(null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLabel(null)
      })
    return () => controller.abort()
  }, [])

  if (!label) return null

  return (
    <p className="px-4 sm:px-6 lg:px-8 pb-2 text-[12px] text-[var(--ck-text-muted)]">
      {label}{' '}
      <Link href="/settings" className="font-semibold text-[var(--ck-accent)] hover:underline">
        Settings
      </Link>
    </p>
  )
}
