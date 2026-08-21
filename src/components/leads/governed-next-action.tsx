'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'

export type LeadNextActionTask = {
  id: string
  title: string
  dueAt: string | null
  assignedTo: string | null
}

type AiProposalResult = {
  proposal: {
    kind: 'follow_up' | 'callback'
    title: string
    notes: string
    dueAt: string
    rationale: string
    confidence: 'high' | 'medium' | 'low'
  }
  generationId: string
  citations: Array<{ name: string; url: string; detail?: string }>
}

type ExistingWork = {
  key: string
  title: string
  dueAt: string | null
  assignedTo: string | null
}

function isoToLocalDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function dueLabel(value: string | null): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'No due date'
  return new Date(value).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function openLeadNextAction(activities: Array<{
  id: string
  activity_type: string
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}>): LeadNextActionTask | null {
  const closed = new Set(['completed', 'complete', 'done', 'cancelled', 'canceled', 'dismissed', 'waived'])
  const actionTypes = new Set(['task', 'follow_up', 'callback', 'send_offer'])
  const candidates = activities.flatMap((activity) => {
    if (!actionTypes.has(activity.activity_type)) return []
    const metadata = activity.metadata || {}
    const status = String(metadata.status || 'pending').trim().toLowerCase()
    if (closed.has(status)) return []
    const dueAtValue = metadata.due_date || metadata.dueAt || metadata.scheduled_at
    const dueAt = typeof dueAtValue === 'string' && Number.isFinite(new Date(dueAtValue).getTime())
      ? new Date(dueAtValue).toISOString()
      : null
    return [{
      id: activity.id,
      title: typeof metadata.title === 'string' && metadata.title.trim()
        ? metadata.title.trim()
        : activity.description?.trim() || 'Complete the next action',
      dueAt,
      assignedTo: typeof metadata.assigned_to === 'string' ? metadata.assigned_to : null,
      primary: metadata.primary_next_action === true,
      createdAt: activity.created_at,
    }]
  })
  candidates.sort((left, right) => {
    if (left.primary !== right.primary) return left.primary ? -1 : 1
    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY
    if (leftDue !== rightDue) return leftDue - rightDue
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })
  const first = candidates[0]
  return first ? { id: first.id, title: first.title, dueAt: first.dueAt, assignedTo: first.assignedTo } : null
}

export function GovernedNextAction({
  leadId,
  task,
  appointment,
  appointmentIsPast,
  onAppointment,
  onAppointmentOutcome,
}: {
  leadId: string
  task: LeadNextActionTask | null
  appointment: { scheduledAt: string; address?: string | null } | null
  appointmentIsPast: boolean
  onAppointment: () => void
  onAppointmentOutcome: () => void
}) {
  const [drafting, setDrafting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [proposal, setProposal] = useState<AiProposalResult | null>(null)
  const [existingWork, setExistingWork] = useState<ExistingWork | null>(null)
  const [kind, setKind] = useState<'follow_up' | 'callback'>('follow_up')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState('')
  const committed = task || existingWork

  async function draftWithAi() {
    if (drafting || committed || appointment) return
    setDrafting(true)
    setError('')
    try {
      const response = await fetch('/api/ai/next-action-proposal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `lead-next-action:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ leadId }),
      })
      const data = await response.json()
      if (response.status === 409 && data.existingWorkItem) {
        setExistingWork(data.existingWorkItem as ExistingWork)
        return
      }
      if (!response.ok) throw new Error(data.error || 'AI draft could not be created.')
      const next = data as AiProposalResult
      if (!next.proposal?.title || !next.generationId) throw new Error('AI draft returned incomplete details.')
      setProposal(next)
      setKind(next.proposal.kind)
      setTitle(next.proposal.title)
      setNotes(next.proposal.notes)
      setDueAt(isoToLocalDateTime(next.proposal.dueAt))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI draft could not be created.')
    } finally {
      setDrafting(false)
    }
  }

  async function requestApproval() {
    if (!proposal || !title.trim() || !dueAt || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/workflows/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `approved-follow-up-task:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          workflowId: 'approved-follow-up-task',
          input: {
            leadId,
            title: title.trim(),
            notes: notes.trim(),
            dueAt: new Date(dueAt).toISOString(),
            kind,
            aiGenerationId: proposal.generationId,
          },
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Approval request could not be created.')
      setRequested(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval request could not be created.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4" aria-labelledby="governed-next-action-title">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]"><Icon name="auto_awesome" className="text-[18px]" /></span>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.09em] text-[var(--crm-violet)]">Human-approved</p>
          <h3 id="governed-next-action-title" className="text-sm font-black text-[var(--crm-ink)]">Next action</h3>
        </div>
      </div>

      {appointment ? (
        <div className="mt-3">
          <p className="text-sm font-bold text-[var(--crm-ink)]">{appointmentIsPast ? 'Record appointment outcome' : 'Run the scheduled appointment'}</p>
          <p className="mt-1 text-xs text-[var(--crm-text-muted)]">{dueLabel(appointment.scheduledAt)}</p>
          <button type="button" onClick={appointmentIsPast ? onAppointmentOutcome : onAppointment} className="crm-secondary-button mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-bold">
            <Icon name={appointmentIsPast ? 'fact_check' : 'event'} />{appointmentIsPast ? 'Record outcome' : 'Open appointment'}
          </button>
        </div>
      ) : committed ? (
        <div className="mt-3">
          <p className="text-sm font-bold text-[var(--crm-ink)]">{committed.title}</p>
          <p className="mt-1 text-xs text-[var(--crm-text-muted)]">{dueLabel(committed.dueAt)}{committed.assignedTo ? ` · ${committed.assignedTo}` : ''}</p>
          <Link href={`/tasks?q=${encodeURIComponent(committed.title)}`} className="crm-secondary-button mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-bold"><Icon name="open_in_new" />Open in Tasks</Link>
        </div>
      ) : requested ? (
        <div className="mt-3 rounded-lg border border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] p-3">
          <p className="text-sm font-black text-[var(--crm-success)]">Approval requested</p>
          <p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">No task exists yet. An administrator must approve the exact request before the workflow creates it.</p>
          <Link href="/workflows" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[var(--crm-info)] underline underline-offset-2">Review workflow <Icon name="arrow_forward" className="text-[14px]" /></Link>
        </div>
      ) : proposal ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-[var(--crm-info)]/20 bg-[var(--crm-info-soft)] p-3 text-xs">
            <p className="font-black text-[var(--crm-ink)]">Cited AI draft · {proposal.proposal.confidence} confidence</p>
            <p className="mt-1 leading-5 text-[var(--crm-text-muted)]">{proposal.proposal.rationale}</p>
            <div className="mt-2 flex flex-wrap gap-2">{proposal.citations.map((citation, index) => <a key={`${citation.url}:${index}`} href={citation.url} target="_blank" rel="noreferrer" className="font-bold text-[var(--crm-info)] underline underline-offset-2">{citation.name}</a>)}</div>
          </div>
          <select aria-label="Next action type" value={kind} onChange={(event) => setKind(event.target.value as 'follow_up' | 'callback')} className="crm-field h-10 w-full rounded-lg px-3 text-sm"><option value="follow_up">Follow-up</option><option value="callback">Callback</option></select>
          <input aria-label="Next action title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="crm-field h-10 w-full rounded-lg px-3 text-sm" />
          <textarea aria-label="Next action notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={2_000} className="crm-field w-full resize-none rounded-lg px-3 py-2 text-sm" />
          <input aria-label="Next action due date" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="crm-field h-10 w-full rounded-lg px-3 text-sm" />
          <button type="button" onClick={() => void requestApproval()} disabled={submitting || !title.trim() || !dueAt} className="crm-primary-button flex h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-black disabled:opacity-50"><Icon name={submitting ? 'progress_activity' : 'approval'} className={submitting ? 'animate-spin' : ''} />{submitting ? 'Requesting…' : 'Request admin approval'}</button>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-xs leading-5 text-[var(--crm-text-muted)]">No committed task is open. AI can draft one from bounded CRM evidence, but it cannot create or execute it.</p>
          <button type="button" onClick={() => void draftWithAi()} disabled={drafting} className="crm-secondary-button mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-black disabled:opacity-50"><Icon name={drafting ? 'progress_activity' : 'auto_awesome'} className={drafting ? 'animate-spin' : ''} />{drafting ? 'Reading CRM…' : 'Draft with AI'}</button>
        </div>
      )}
      {error ? <p role="alert" className="mt-3 text-xs font-semibold text-[var(--crm-danger)]">{error}</p> : null}
    </section>
  )
}
