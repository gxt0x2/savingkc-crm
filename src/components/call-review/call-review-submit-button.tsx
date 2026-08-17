'use client'

import { useState } from 'react'
import { DEFAULT_CALL_REVIEWER } from '@/lib/call-review-reviewers'

const DEFAULT_FRAMEWORK = 'junior_acquisitions'

export function CallReviewSubmitButton({ activityId, recordingSid }: { activityId?: string; recordingSid?: string }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/marketing/call-recordings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId,
          recordingSid,
          action: 'submit',
          framework: DEFAULT_FRAMEWORK,
          assignedReviewer: DEFAULT_CALL_REVIEWER.email,
        }),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'Call could not be submitted.')
      setMessage(`Sent to ${DEFAULT_CALL_REVIEWER.name} for review.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Call could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  if (!activityId && !recordingSid) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-md border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-1.5 text-[11px] font-black text-[var(--crm-brand)] disabled:cursor-wait disabled:opacity-60">
        {busy ? 'Submitting…' : 'Submit for Review'}
      </button>
      {message ? <span role="status" className="text-[11px] font-bold text-[var(--crm-text-muted)]">{message}</span> : null}
    </div>
  )
}
