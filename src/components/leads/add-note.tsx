'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'

interface AddNoteProps {
  leadId: string
  onNoteAdded: (note: { id: string; activity_type: string; description: string; agent: string; metadata: Record<string, unknown> | null; created_at: string }) => void
}

export function AddNote({ leadId, onNoteAdded }: AddNoteProps) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  async function handleSubmit() {
    if (!content.trim()) return
    setSaving(true)

    const supabase = createClient()
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        activity_type: 'note',
        description: content.trim(),
        agent: 'User',
        metadata: { source: 'manual_note' },
        created_at: now,
      })
      .select('id, activity_type, description, agent, metadata, created_at')
      .single()

    if (!error && data) {
      onNoteAdded(data as { id: string; activity_type: string; description: string; agent: string; metadata: Record<string, unknown> | null; created_at: string })

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
    }

    setSaving(false)
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
    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="edit_note" className="text-primary" size="text-lg" />
        <h3 className="text-sm font-bold text-primary">Add Note</h3>
      </div>
      <textarea
        autoFocus
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Type your note here... (mention price, timeline, condition, or motivation to trigger Ari analysis)"
        className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[80px]"
        rows={3}
      />
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={() => { setExpanded(false); setContent('') }}
          className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-all"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || !content.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
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
