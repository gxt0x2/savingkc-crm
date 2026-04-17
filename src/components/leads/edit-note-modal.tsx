'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface EditNoteModalProps {
  noteId: string
  initialContent: string
  onClose: () => void
  onSaved: (noteId: string, newContent: string) => void
}

export function EditNoteModal({ noteId, initialContent, onClose, onSaved }: EditNoteModalProps) {
  const [content, setContent] = useState(initialContent)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!content.trim()) return
    setSaving(true)

    try {
      const res = await fetch(`/api/leads/activities/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: content.trim() }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        console.error('Failed to update note:', data.error)
        alert('Failed to update note')
        return
      }

      onSaved(noteId, content.trim())
      onClose()
    } catch (err) {
      console.error('Error updating note:', err)
      alert('Failed to update note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-lg">
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
            <div className="flex items-center gap-2">
              <Icon name="edit_note" className="text-primary" />
              <h2 className="text-lg font-bold text-primary">Edit Note</h2>
            </div>
            <button
              onClick={onClose}
              className="text-on-surface-variant hover:text-primary transition-colors"
            >
              <Icon name="close" />
            </button>
          </div>

          <div className="px-6 py-4">
            <textarea
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Type your note here..."
              className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[120px]"
              rows={5}
            />
          </div>

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-outline-variant/10">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !content.trim() || content.trim() === initialContent.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {saving ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Icon name="save" size="text-sm" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
