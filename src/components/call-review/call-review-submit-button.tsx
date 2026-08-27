'use client'

import { useState } from 'react'
import { DEFAULT_CALL_REVIEWER } from '@/lib/call-review-reviewers'
import { savePreviewCallReviewSubmission } from '@/lib/call-review-preview-queue'
import { CALL_REVIEW_SUBMISSION_NOTE_MAX_LENGTH } from '@/lib/marketing/call-recordings'

const DEFAULT_FRAMEWORK = 'junior_acquisitions'

export function CallReviewSubmitButton({ activityId, recordingSid, recordingUrl, durationSeconds = 0 }: { activityId?: string; recordingSid?: string; recordingUrl?: string; durationSeconds?: number }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [note, setNote] = useState('')

  async function submit() {
    const submissionNote = note.trim()
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
          note: submissionNote,
        }),
      })
      const payload = await response.json().catch(() => null) as { error?: string; previewReadOnly?: boolean } | null
      if (!response.ok && payload?.previewReadOnly && recordingUrl) {
        savePreviewCallReviewSubmission(window.localStorage, {
          activityId: activityId || null,
          recordingSid: recordingSid || null,
          recordingUrl,
          durationSeconds: Math.max(0, Math.round(durationSeconds)),
          submittedAt: new Date().toISOString(),
          submissionNote: submissionNote || null,
        })
        setNote('')
        setMessage(`Preview submission saved. Open My Day to review it.`)
        return
      }
      if (!response.ok) throw new Error(payload?.error || 'Call could not be submitted.')
      setNote('')
      setMessage(`Sent to ${DEFAULT_CALL_REVIEWER.name} for review.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Call could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  if (!activityId && !recordingSid) return null

  return (
    <div className="mt-2 max-w-xl">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`call-review-note-${activityId || recordingSid}`}>Quick note to reviewer (optional)</label>
        <input
          id={`call-review-note-${activityId || recordingSid}`}
          aria-label="Quick note to reviewer"
          className="crm-field h-8 min-w-52 flex-1 rounded-md px-2 text-[11px] font-normal"
          disabled={busy}
          maxLength={CALL_REVIEW_SUBMISSION_NOTE_MAX_LENGTH}
          onChange={(event) => { setNote(event.target.value); setMessage(null) }}
          placeholder="Note to reviewer (optional)"
          value={note}
        />
        <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-md border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-1.5 text-[11px] font-black text-[var(--crm-brand)] disabled:cursor-wait disabled:opacity-60">
          {busy ? 'Submitting…' : 'Submit for Review'}
        </button>
      </div>
      {message ? <span role="status" className="mt-1 block text-[11px] font-bold text-[var(--crm-text-muted)]">{message}</span> : null}
    </div>
  )
}
