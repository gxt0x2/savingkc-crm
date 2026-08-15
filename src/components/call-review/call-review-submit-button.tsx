'use client'

import { useState } from 'react'
import { CALL_REVIEW_FRAMEWORKS, type CallReviewFrameworkId } from '@/lib/call-review-frameworks'
import { CALL_REVIEWERS } from '@/lib/call-review-reviewers'

export function CallReviewSubmitButton({ activityId, recordingSid }: { activityId?: string; recordingSid?: string }) {
  const [open, setOpen] = useState(false)
  const [framework, setFramework] = useState<CallReviewFrameworkId>('junior_acquisitions')
  const [assignedReviewer, setAssignedReviewer] = useState<string>(CALL_REVIEWERS[0].email)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/marketing/call-recordings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId, recordingSid, action: 'submit', framework, assignedReviewer }),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || 'Call could not be submitted.')
      setMessage(`Sent to ${CALL_REVIEWERS.find((reviewer) => reviewer.email === assignedReviewer)?.name}.`)
      setOpen(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Call could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  if (!activityId && !recordingSid) return null

  return (
    <div className="relative mt-2">
      <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-md border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-1.5 text-[11px] font-black text-[var(--crm-brand)]">
        Submit for review
      </button>
      {message ? <span className="ml-2 text-[11px] font-bold text-[var(--crm-text-muted)]">{message}</span> : null}
      {open ? <div className="mt-2 grid gap-2 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 shadow-lg sm:grid-cols-[minmax(170px,1fr)_150px_auto]">
        <select aria-label="Call review framework" value={framework} onChange={(event) => setFramework(event.target.value as CallReviewFrameworkId)} className="crm-field h-9 rounded-md px-2 text-xs font-bold">{CALL_REVIEW_FRAMEWORKS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        <select aria-label="Call reviewer" value={assignedReviewer} onChange={(event) => setAssignedReviewer(event.target.value)} className="crm-field h-9 rounded-md px-2 text-xs font-bold">{CALL_REVIEWERS.map((reviewer) => <option key={reviewer.email} value={reviewer.email}>{reviewer.name}</option>)}</select>
        <button type="button" disabled={busy} onClick={() => void submit()} className="crm-primary-button h-9 rounded-md px-3 text-xs font-black">{busy ? 'Sending' : 'Send'}</button>
      </div> : null}
    </div>
  )
}
