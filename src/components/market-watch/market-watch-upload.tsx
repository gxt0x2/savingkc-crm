'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { useIsAdmin } from '@/hooks/use-is-admin'

import styles from './market-watch.module.css'

export function MarketWatchUpload({ onUploaded }: { onUploaded: (monthKey: string) => void }) {
  const { isAdmin, loading } = useIsAdmin()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (loading || !isAdmin) return null

  async function upload(formData: FormData) {
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const file = formData.get('snapshot')
      if (!(file instanceof File) || file.size < 1) {
        setError('Choose a report-data.json file')
        return
      }
      let payload: unknown
      try {
        payload = JSON.parse(await file.text())
      } catch {
        setError('That file is not JSON')
        return
      }
      const response = await fetch('/api/market-watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => null) as { error?: string; month_key?: string; month?: string } | null
      if (!response.ok || !body?.month_key) {
        setError(body?.error || 'The snapshot was not saved')
        return
      }
      setMessage(`Saved ${body.month || body.month_key}. This did not create contacts or dialer rows.`)
      onUploaded(body.month_key)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className={styles.upload}>
      <summary>Add or replace a month</summary>
      <p>
        Upload the next month&apos;s <code>report-data.json</code>. The same month key replaces that snapshot.
        Market Watch does not create contacts, opportunities, or dialer rows.
      </p>
      <form action={(formData) => { void upload(formData) }}>
        <input name="snapshot" type="file" accept="application/json,.json" aria-label="Market snapshot JSON" />
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save snapshot'}</button>
      </form>
      {message ? <p className={styles.status} role="status">{message}</p> : null}
      {error ? <p className={styles.status} role="alert">{error}</p> : null}
    </details>
  )
}
