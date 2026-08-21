'use client'

import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'

type LeadOption = {
  id: string
  full_name: string | null
  property_address: string | null
}

type ApprovedFollowUpRunFormProps = {
  disabled?: boolean
  onSubmitted: () => Promise<void> | void
}

function defaultDueDate(): string {
  const date = new Date()
  date.setHours(date.getHours() + 1, 0, 0, 0)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function ApprovedFollowUpRunForm({ disabled = false, onSubmitted }: ApprovedFollowUpRunFormProps) {
  const prefix = useId()
  const searchAbort = useRef<AbortController | null>(null)
  const [leadSearch, setLeadSearch] = useState('')
  const [leadId, setLeadId] = useState('')
  const [results, setResults] = useState<LeadOption[]>([])
  const [searching, setSearching] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'follow_up' | 'callback'>('follow_up')
  const [assignedTo, setAssignedTo] = useState('')
  const [dueAt, setDueAt] = useState(defaultDueDate)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => searchAbort.current?.abort(), [])

  async function searchLeads(query: string) {
    searchAbort.current?.abort()
    setResults([])
    if (query.trim().length < 2) {
      setSearching(false)
      return
    }
    const controller = new AbortController()
    searchAbort.current = controller
    setSearching(true)
    try {
      const response = await fetch(`/api/leads/search?q=${encodeURIComponent(query.trim())}&limit=8`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Contact search is unavailable.')
      setResults(Array.isArray(data.results) ? data.results : [])
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') setError(cause instanceof Error ? cause.message : 'Contact search is unavailable.')
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }

  function resetForm() {
    setLeadSearch('')
    setLeadId('')
    setResults([])
    setTitle('')
    setKind('follow_up')
    setAssignedTo('')
    setDueAt(defaultDueDate())
    setNotes('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!leadId || !title.trim() || !dueAt || submitting || disabled) return
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
            notes: notes.trim() || null,
            dueAt: new Date(dueAt).toISOString(),
            assignedTo: assignedTo || undefined,
            kind,
          },
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Approval request could not be created.')
      resetForm()
      try {
        await onSubmitted()
      } catch {
        setError('Approval request was created, but run history could not refresh. Do not submit it again.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval request could not be created.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]"><Icon name="approval" /></span>
        <div>
          <h3 className="font-black text-[var(--crm-ink)]">Request an approved follow-up</h3>
          <p className="mt-1 text-sm text-[var(--crm-text-muted)]">No task is created until an administrator approves these exact details.</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="relative lg:col-span-2">
          <label htmlFor={`${prefix}-contact`} className="mb-1 block text-xs font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Contact</label>
          <input
            id={`${prefix}-contact`}
            value={leadSearch}
            onChange={(event) => {
              const value = event.target.value
              setLeadSearch(value)
              setLeadId('')
              setError('')
              void searchLeads(value)
            }}
            placeholder="Search seller name or property address..."
            autoComplete="off"
            className="crm-field min-h-11 w-full rounded-xl px-3 text-base"
          />
          {leadSearch.trim().length >= 2 && !leadId ? (
            <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-xl">
              {searching ? <p className="px-3 py-3 text-sm font-semibold text-[var(--crm-text-muted)]">Searching contacts…</p> : null}
              {!searching && results.length === 0 ? <p className="px-3 py-3 text-sm text-[var(--crm-text-muted)]">No matching contacts.</p> : null}
              {results.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => {
                    setLeadId(lead.id)
                    setLeadSearch(lead.full_name || lead.property_address || 'Selected contact')
                    setResults([])
                  }}
                  className="w-full border-b border-[var(--crm-border)] px-3 py-2.5 text-left last:border-0 hover:bg-[var(--crm-surface-subtle)]"
                >
                  <strong className="block text-sm text-[var(--crm-ink)]">{lead.full_name || 'Unknown seller'}</strong>
                  {lead.property_address ? <span className="text-xs text-[var(--crm-text-muted)]">{lead.property_address}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {leadId ? <p className="mt-1 text-xs font-bold text-[var(--crm-success)]">Contact selected</p> : null}
        </div>

        <div className="lg:col-span-2">
          <label htmlFor={`${prefix}-title`} className="mb-1 block text-xs font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Task title</label>
          <input id={`${prefix}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="What should happen next?" className="crm-field min-h-11 w-full rounded-xl px-3 text-base" />
        </div>

        <div>
          <label htmlFor={`${prefix}-kind`} className="mb-1 block text-xs font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Type</label>
          <select id={`${prefix}-kind`} value={kind} onChange={(event) => setKind(event.target.value as 'follow_up' | 'callback')} className="crm-field min-h-11 w-full rounded-xl px-3 text-base">
            <option value="follow_up">Follow-up</option>
            <option value="callback">Callback</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${prefix}-owner`} className="mb-1 block text-xs font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Owner</label>
          <select id={`${prefix}-owner`} value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="crm-field min-h-11 w-full rounded-xl px-3 text-base">
            <option value="">Me</option>
            <option value="Casey">Casey</option>
            <option value="Ernest">Ernest</option>
            <option value="Gertha">Gertha</option>
          </select>
        </div>
        <div className="lg:col-span-2">
          <label htmlFor={`${prefix}-due`} className="mb-1 block text-xs font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Due date</label>
          <input id={`${prefix}-due`} type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="crm-field min-h-11 w-full rounded-xl px-3 text-base" />
        </div>
        <div className="lg:col-span-2">
          <label htmlFor={`${prefix}-notes`} className="mb-1 block text-xs font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Notes <span className="font-medium normal-case">(optional)</span></label>
          <textarea id={`${prefix}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} className="crm-field w-full resize-y rounded-xl px-3 py-2 text-base" />
        </div>
      </div>

      {error ? <p role="alert" className="mt-3 rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-danger)]">{error}</p> : null}
      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={disabled || submitting || !leadId || !title.trim() || !dueAt} className="crm-primary-button inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-black disabled:opacity-40">
          <Icon name={submitting ? 'progress_activity' : 'approval'} className={submitting ? 'animate-spin' : ''} />
          {submitting ? 'Requesting…' : 'Request approval'}
        </button>
      </div>
    </form>
  )
}
