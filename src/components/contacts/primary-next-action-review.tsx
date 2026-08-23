'use client'

import { FormEvent, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { PipelineModal } from '@/components/pipeline/pipeline-controls'
import { Icon } from '@/components/ui/icon'

interface ReviewCandidate {
  key: string
  kind: string
  title: string
  description: string | null
  status: 'pending' | 'blocked'
  dueAt: string | null
  assignedTo: string | null
  version: number
  provenanceClass: 'governed_human' | 'legacy_operator'
}

interface PrimaryNextActionReview {
  schemaVersion: 1
  leadId: string
  activeOpportunity: boolean
  resolutionKind: 'select' | 'create' | 'resolved' | 'ineligible'
  primaryNextAction: { key: string; title: string; dueAt: string | null; assignedTo: string | null; version: number } | null
  candidates: ReviewCandidate[]
  excludedAdvisoryCount: number
}

function tomorrowAtTen() {
  const value = new Date()
  value.setDate(value.getDate() + 1)
  value.setHours(10, 0, 0, 0)
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function dueLabel(value: string | null) {
  if (!value) return 'No due date'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'No due date' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function PrimaryNextActionReviewDialog({
  leadId,
  contactName,
  onClose,
  onResolved,
}: {
  leadId: string
  contactName: string
  onClose: () => void
  onResolved: () => void | Promise<void>
}) {
  const [selectedKey, setSelectedKey] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('follow_up')
  const [dueAt, setDueAt] = useState(tomorrowAtTen)
  const [assignedTo, setAssignedTo] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [idempotencyKey] = useState(() => `primary-review-${leadId}-${crypto.randomUUID()}`)
  const reviewQuery = useQuery<PrimaryNextActionReview>({
    queryKey: ['primary-next-action-review', leadId],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${leadId}/primary-next-action`, { cache: 'no-store' })
      const payload = await response.json().catch(() => ({})) as { review?: PrimaryNextActionReview; error?: string }
      if (!response.ok || !payload.review) throw new Error(payload.error || 'Primary-action review could not be loaded.')
      return payload.review
    },
    staleTime: 0,
    retry: false,
  })

  const review = reviewQuery.data
  const selectedCandidate = review?.candidates.find((candidate) => candidate.key === selectedKey) ?? null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!review || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const body = review.resolutionKind === 'select'
        ? {
            action: 'select_existing',
            workItemKey: selectedCandidate?.key,
            expectedVersion: selectedCandidate?.version,
          }
        : {
            action: 'create',
            title: title.trim(),
            kind,
            dueAt: new Date(dueAt).toISOString(),
            notes: notes.trim() || undefined,
            ...(assignedTo ? { assignedTo } : {}),
          }
      const response = await fetch(`/api/contacts/${leadId}/primary-next-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Primary action could not be saved.')
      await onResolved()
      onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Primary action could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return <PipelineModal title={`Review next action · ${contactName}`} onClose={saving ? () => undefined : onClose}>
    {reviewQuery.isLoading ? <div role="status" className="flex min-h-44 items-center justify-center gap-2 text-sm font-semibold text-[var(--crm-text-muted)]"><Icon name="progress_activity" className="animate-spin" />Loading current tasks…</div> : null}
    {reviewQuery.error ? <div role="alert" className="rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] p-4 text-sm text-[var(--crm-danger)]"><p>{reviewQuery.error.message}</p><button type="button" onClick={() => void reviewQuery.refetch()} className="mt-3 font-black underline">Try again</button></div> : null}
    {review ? <form onSubmit={submit} className="space-y-5">
      <div className="rounded-xl border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] p-4 text-sm leading-6 text-[var(--crm-text)]">
        <p className="font-black text-[var(--crm-info)]">Human decision required</p>
        <p>Only current tasks created by an operator are eligible. AI, manifest, event, and unreviewed automation suggestions cannot be selected here.</p>
      </div>

      {review.resolutionKind === 'select' ? <fieldset className="space-y-3">
        <legend className="text-sm font-black text-[var(--crm-ink)]">Choose the one task that should drive this opportunity</legend>
        {review.candidates.map((candidate) => <label key={candidate.key} className={`block cursor-pointer rounded-xl border p-4 transition-colors ${selectedKey === candidate.key ? 'border-[var(--crm-action)] bg-[var(--crm-action-soft)]' : 'border-[var(--crm-border)] hover:border-[var(--crm-border-strong)]'}`}>
          <span className="flex items-start gap-3"><input type="radio" name="primary-candidate" value={candidate.key} checked={selectedKey === candidate.key} onChange={() => setSelectedKey(candidate.key)} className="mt-1 h-4 w-4 accent-[var(--crm-action)]" /><span className="min-w-0"><strong className="block text-sm text-[var(--crm-ink)]">{candidate.title}</strong><span className="mt-1 block text-xs text-[var(--crm-text-muted)]">{candidate.kind.replaceAll('_', ' ')} · {dueLabel(candidate.dueAt)} · {candidate.assignedTo || 'Unassigned'}</span>{candidate.description ? <span className="mt-2 block text-xs leading-5 text-[var(--crm-text)]">{candidate.description}</span> : null}</span></span>
        </label>)}
      </fieldset> : null}

      {review.resolutionKind === 'create' ? <div className="space-y-4">
        <p className="text-sm font-black text-[var(--crm-ink)]">Create one clear, owned, dated next action</p>
        <label className="block"><span className="mb-1 block text-xs font-bold text-[var(--crm-text-muted)]">Action</span><input autoFocus required maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Example: Call seller with updated offer" className="crm-field h-11 w-full rounded-lg px-3 text-sm" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="mb-1 block text-xs font-bold text-[var(--crm-text-muted)]">Type</span><select value={kind} onChange={(event) => setKind(event.target.value)} className="crm-field h-11 w-full rounded-lg px-3 text-sm"><option value="follow_up">Follow up</option><option value="callback">Callback</option><option value="appointment">Appointment</option><option value="send_offer">Send offer</option><option value="task">Task</option></select></label>
          <label><span className="mb-1 block text-xs font-bold text-[var(--crm-text-muted)]">Owner</span><select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="crm-field h-11 w-full rounded-lg px-3 text-sm"><option value="">Signed-in agent</option><option value="Ernest">Ernest</option><option value="Casey">Casey</option><option value="Gertha">Gertha</option></select></label>
        </div>
        <label className="block"><span className="mb-1 block text-xs font-bold text-[var(--crm-text-muted)]">Due</span><input required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="crm-field h-11 w-full rounded-lg px-3 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-[var(--crm-text-muted)]">Notes <span className="font-normal">(optional)</span></span><textarea maxLength={2_000} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="crm-field w-full rounded-lg px-3 py-2 text-sm" /></label>
      </div> : null}

      {review.resolutionKind === 'resolved' ? <div role="status" className="rounded-xl border border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] p-4 text-sm text-[var(--crm-success)]"><p className="font-black">Already resolved</p><p className="mt-1">{review.primaryNextAction?.title}</p></div> : null}
      {review.resolutionKind === 'ineligible' ? <div role="status" className="rounded-xl border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] p-4 text-sm text-[var(--crm-warning)]">This contact is no longer an active opportunity, so no primary action was created.</div> : null}
      {review.excludedAdvisoryCount > 0 ? <p className="text-xs text-[var(--crm-text-muted)]">{review.excludedAdvisoryCount} advisory or untrusted row{review.excludedAdvisoryCount === 1 ? ' was' : 's were'} excluded from this decision.</p> : null}
      {saveError ? <p role="alert" className="text-sm font-bold text-[var(--crm-danger)]">{saveError}</p> : null}

      <div className="flex gap-3 pt-1"><button type="button" disabled={saving} onClick={onClose} className="crm-secondary-button h-11 flex-1 rounded-lg text-sm font-bold">Cancel</button>{review.resolutionKind === 'select' || review.resolutionKind === 'create' ? <button type="submit" disabled={saving || (review.resolutionKind === 'select' ? !selectedCandidate : !title.trim() || !dueAt)} className="crm-primary-button h-11 flex-1 rounded-lg text-sm font-black disabled:opacity-45">{saving ? 'Saving…' : review.resolutionKind === 'select' ? 'Use selected task' : 'Create primary action'}</button> : null}</div>
    </form> : null}
  </PipelineModal>
}
