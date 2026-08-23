'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface AddNoteProps {
  leadId: string
  onNoteAdded: (note: { id: string; activity_type: string; description: string; agent: string; metadata: Record<string, unknown> | null; created_at: string }) => void
  /** When true, render the expanded form immediately (no collapsed "Add a note…" button) */
  alwaysExpanded?: boolean
  /** When true, hide the internal "Add Note" heading (parent already shows one) */
  hideHeading?: boolean
  /** When true, hide the Cancel button (parent modal owns dismissal) */
  hideCancel?: boolean
}

export function AddNote({ leadId, onNoteAdded, alwaysExpanded, hideHeading, hideCancel }: AddNoteProps) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(!!alwaysExpanded)

  async function handleSubmit() {
    if (!content.trim()) return
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/leads/${leadId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: content.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.activity) {
        throw new Error(payload.error || 'Unable to save note')
      }

      onNoteAdded(payload.activity as { id: string; activity_type: string; description: string; agent: string; metadata: Record<string, unknown> | null; created_at: string })

      // Trigger manifest update + briefing refresh via server API
      fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: leadId,
          activity: {
            type: 'note',
            disposition: 'note_added',
            notes: content.trim(),
          },
        }),
      }).catch(() => {})

      setContent('')
      setExpanded(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save note')
    } finally {
      setSaving(false)
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant/10 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container-low transition-all"
      >
        <Icon name="edit_note" size="text-lg" />
        <span className="font-medium">Add a note...</span>
      </button>
    )
  }

  return (
    <div
      className="rounded-xl p-4 border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      {!hideHeading && (
        <div className="flex items-center gap-2 mb-3">
          <Icon name="edit_note" className="!text-[color:var(--ck-accent)]" size="text-lg" />
          <h3 className="text-sm font-bold" style={{ color: 'var(--ck-text)' }}>Add Note</h3>
        </div>
      )}
      <textarea
        autoFocus
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Type your note here... (mention price, timeline, condition, or motivation to trigger Ari analysis)"
        className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none min-h-[100px]"
        style={{
          background: 'var(--ck-surface-elev)',
          border: '1px solid var(--ck-border)',
          color: 'var(--ck-text)',
        }}
        rows={4}
      />
      {error && (
        <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--ck-accent-bright)' }}>
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-3">
        {!hideCancel && (
          <button
            onClick={() => { setExpanded(!!alwaysExpanded); setContent('') }}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-all"
            style={{ color: 'var(--ck-text-muted)' }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={saving || !content.trim()}
          className="flex items-center gap-1.5 px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-50 transition-all"
          style={{
            background: 'var(--ck-accent)',
            boxShadow: '0 4px 16px rgba(239,68,68,0.22)',
          }}
        >
          {saving ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Icon name="send" size="text-sm" />
              Save Note
            </>
          )}
        </button>
      </div>
    </div>
  )
}
