'use client'

import { useState } from 'react'

import { Icon } from '@/components/ui/icon'

export function ContactNoteComposer({ contactName, onSave }: { contactName: string; onSave: (description: string) => Promise<void> }) {
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const description = note.trim()
    if (!description || status === 'saving') return
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

  return <div className="mt-3 rounded-lg border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] p-2.5">
    <form onSubmit={(event) => { event.preventDefault(); void submit() }} className="flex items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Note for {contactName}</span>
        <textarea
          value={note}
          onChange={(event) => { setNote(event.target.value); setStatus('idle'); setError(null) }}
          rows={1}
          maxLength={2_000}
          placeholder={`Add a note for ${contactName}…`}
          className="crm-field min-h-10 w-full resize-y rounded-lg px-3 py-2 text-xs leading-5"
        />
      </label>
      <button type="submit" disabled={!note.trim() || status === 'saving'} className="crm-secondary-button inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-black disabled:opacity-40">
        <Icon name={status === 'saving' ? 'progress_activity' : 'note_add'} size="text-sm" className={status === 'saving' ? 'animate-spin' : ''} />
        {status === 'saving' ? 'Saving…' : 'Save note'}
      </button>
    </form>
    {status === 'saved' ? <p role="status" className="mt-1.5 text-[10px] font-bold text-[var(--crm-success)]">Note saved to this contact.</p> : null}
    {error ? <p role="alert" className="mt-1.5 text-[10px] font-bold text-[var(--crm-danger)]">{error}</p> : null}
  </div>
}
