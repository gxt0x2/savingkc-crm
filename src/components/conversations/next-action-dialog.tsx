'use client'

import { useId, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'

export interface ConversationNextAction {
  id: string
  title: string
  dueAt: string | null
  owner: string | null
  overdue: boolean
}

function dateTimeLocal(value: string | null): string {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  if (!Number.isFinite(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function NextActionDialog({
  leadId,
  leadName,
  action,
  defaultOwner,
  onClose,
  onSaved,
}: {
  leadId: string
  leadName: string
  action: ConversationNextAction | null
  defaultOwner: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(action?.title ?? '')
  const [taskType, setTaskType] = useState('follow_up')
  const [assignedTo, setAssignedTo] = useState(action ? action.owner || '__unchanged' : defaultOwner || '__me')
  const [dueDate, setDueDate] = useState(() => dateTimeLocal(action?.dueAt ?? null))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const fieldId = useId()
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useDialogAccessibility<HTMLFormElement>(true, onClose, titleRef)

  async function saveAction(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || !dueDate || saving) return
    setSaving(true)
    setError(null)

    try {
      const dueAt = new Date(dueDate).toISOString()
      const owner = assignedTo === '__me' || assignedTo === '__unchanged' ? {} : { assignedTo }
      const response = action
        ? await fetch(`/api/calendar/tasks/${action.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: title.trim(),
              dueDate: dueAt,
              notes: notes.trim(),
              ...owner,
            }),
          })
        : await fetch('/api/calendar/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: title.trim(),
              taskType,
              dueDate: dueAt,
              ...owner,
              role: 'setter',
              notes: notes.trim(),
              leadId,
              department: 'acquisitions',
              primaryNextAction: true,
            }),
          })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Unable to save the next action')
      onSaved()
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save the next action')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onSubmit={saveAction}
        className="crm-modal-surface w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--crm-border)] px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name="bolt" /></span>
            <div>
              <h2 id={titleId} className="text-lg font-black text-[var(--crm-ink)]">{action ? 'Edit next action' : 'Define the next action'}</h2>
              <p className="mt-0.5 text-xs text-[var(--crm-text-muted)]">{leadName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close next action dialog" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="close" /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <label className="block text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]" htmlFor={`${fieldId}-title`}>
            Action
            <input ref={titleRef} id={`${fieldId}-title`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Call the seller, run comps, send offer…" className="crm-field mt-2 h-11 w-full rounded-lg px-3 text-sm font-semibold normal-case tracking-normal" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            {!action ? <label className="block text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]" htmlFor={`${fieldId}-type`}>
              Type
              <select id={`${fieldId}-type`} value={taskType} onChange={(event) => setTaskType(event.target.value)} className="crm-field mt-2 h-11 w-full rounded-lg px-3 text-sm font-semibold normal-case tracking-normal">
                <option value="follow_up">Follow-up</option>
                <option value="callback">Callback</option>
                <option value="appointment">Appointment</option>
                <option value="research">Research</option>
                <option value="offer">Send offer</option>
              </select>
            </label> : null}
            <label className="block text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]" htmlFor={`${fieldId}-owner`}>
              Owner
              <select id={`${fieldId}-owner`} value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="crm-field mt-2 h-11 w-full rounded-lg px-3 text-sm font-semibold normal-case tracking-normal">
                {action?.owner ? null : <option value={action ? '__unchanged' : '__me'}>{action ? 'Keep unassigned' : 'Me (current user)'}</option>}
                <option value="Ernest">Ernest</option>
                <option value="Casey">Casey</option>
                <option value="Gertha">Gertha</option>
              </select>
            </label>
          </div>

          <label className="block text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]" htmlFor={`${fieldId}-due`}>
            Due
            <input id={`${fieldId}-due`} type="datetime-local" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="crm-field mt-2 h-11 w-full rounded-lg px-3 text-sm font-semibold normal-case tracking-normal" />
          </label>

          <label className="block text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]" htmlFor={`${fieldId}-notes`}>
            Notes <span className="font-semibold normal-case tracking-normal">(optional)</span>
            <textarea id={`${fieldId}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="What should the agent know before completing this?" className="crm-field mt-2 w-full resize-none rounded-lg px-3 py-2 text-sm font-medium normal-case tracking-normal" />
          </label>

          {error ? <p role="alert" className="rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-brand)]">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-6 py-4">
          <button type="button" onClick={onClose} className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-bold">Cancel</button>
          <button type="submit" aria-label={action ? 'Save action' : 'Create action'} disabled={!title.trim() || !dueDate || saving} className="crm-primary-button flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">
            <Icon name={saving ? 'progress_activity' : 'check'} className={saving ? 'animate-spin' : ''} />
            {saving ? 'Saving…' : action ? 'Save action' : 'Create action'}
          </button>
        </div>
      </form>
    </div>
  )
}
