'use client'

import { useState } from 'react'

import { Icon } from '@/components/ui/icon'

export function ContactNoteComposer({
  contactName,
  onSave,
  readOnlyPreview = false,
  rows = 1,
  variant = 'compact',
}: {
  contactName: string
  onSave: (description: string) => Promise<void>
  readOnlyPreview?: boolean
  rows?: number
  variant?: 'compact' | 'workspace'
}) {
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const description = note.trim()
    if (readOnlyPreview || !description || status === 'saving') return
    setStatus('saving')
    setError(null)
    try {
      await onSave(description)
      setNote('')
      setStatus('saved')
    } catch (saveError) {
      setStatus('idle')
      setError(saveError instanceof Error ? saveError.message : 'Could not save contact note')
    }
  }

  if (variant === 'workspace') return <div className="mt-4">
    <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <label className="block">
        <span className="mb-2 block text-[11px] font-medium text-[var(--ck-text-muted)]">Call notes</span>
        <textarea
          aria-label={`Note for ${contactName}`}
          value={note}
          onChange={(event) => { setNote(event.target.value); setStatus('idle'); setError(null) }}
          rows={rows}
          maxLength={2_000}
          disabled={readOnlyPreview}
          placeholder="Type what you learn during the conversation..."
          className="min-h-[98px] w-full resize-y rounded-lg border border-[var(--prospecting-border)] bg-[var(--prospecting-elevated)] px-3 py-2 text-xs leading-5 text-[var(--ck-text)] outline-none placeholder:text-[var(--ck-text-dim)] focus:border-[var(--prospecting-border-strong)] disabled:cursor-not-allowed"
        />
      </label>
      <button type="submit" aria-label="Save note" disabled={readOnlyPreview || !note.trim() || status === 'saving'} title={readOnlyPreview ? 'Available in a live calling session' : undefined} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--prospecting-primary)] px-3 text-xs font-bold text-[var(--prospecting-on-primary)] transition-colors hover:bg-[var(--prospecting-primary-strong)] disabled:cursor-not-allowed">
        <Icon name={status === 'saving' ? 'progress_activity' : 'save'} size="text-sm" className={status === 'saving' ? 'animate-spin' : ''} />
        {status === 'saving' ? 'Saving…' : 'Save Note'}
      </button>
    </form>
    {status === 'saved' ? <p role="status" className="mt-1.5 text-[10px] font-bold text-[var(--crm-success)]">Note saved to this contact.</p> : null}
    {error ? <p role="alert" className="mt-1.5 text-[10px] font-bold text-[var(--crm-danger)]">{error}</p> : null}
  </div>

  return <div className="mt-3 rounded-lg border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] p-2.5">
    <form onSubmit={(event) => { event.preventDefault(); void submit() }} className="flex items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Note for {contactName}</span>
        <textarea
          value={note}
          onChange={(event) => { setNote(event.target.value); setStatus('idle'); setError(null) }}
          rows={rows}
          maxLength={2_000}
          disabled={readOnlyPreview}
          placeholder={`Add a note for ${contactName}…`}
          className="crm-field min-h-10 w-full resize-y rounded-lg px-3 py-2 text-xs leading-5 disabled:cursor-not-allowed disabled:opacity-70"
        />
      </label>
      <button type="submit" disabled={readOnlyPreview || !note.trim() || status === 'saving'} title={readOnlyPreview ? 'Available in a live calling session' : undefined} className="crm-secondary-button inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40">
        <Icon name={status === 'saving' ? 'progress_activity' : 'note_add'} size="text-sm" className={status === 'saving' ? 'animate-spin' : ''} />
        {status === 'saving' ? 'Saving…' : 'Save note'}
      </button>
    </form>
    {readOnlyPreview ? <p className="mt-1.5 text-[10px] font-bold text-[var(--crm-text-muted)]">Notes are visible for workflow review and save only during live calling.</p> : null}
    {status === 'saved' ? <p role="status" className="mt-1.5 text-[10px] font-bold text-[var(--crm-success)]">Note saved to this contact.</p> : null}
    {error ? <p role="alert" className="mt-1.5 text-[10px] font-bold text-[var(--crm-danger)]">{error}</p> : null}
  </div>
}
