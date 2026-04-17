'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface EditNoteModalProps {
  noteId: string
  initialContent: string
  onClose: () => void
  onSaved: (noteId: string, newContent: string) => void
  onDeleted?: (noteId: string) => void
}

export function EditNoteModal({ noteId, initialContent, onClose, onSaved, onDeleted }: EditNoteModalProps) {
  const [content, setContent] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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

  async function handleDelete() {
    setDeleting(true)

    try {
      const res = await fetch(`/api/leads/activities/${noteId}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        console.error('Failed to delete note:', data.error)
        alert('Failed to delete note')
        return
      }

      onDeleted?.(noteId)
      onClose()
    } catch (err) {
      console.error('Error deleting note:', err)
      alert('Failed to delete note')
    } finally {
      setDeleting(false)
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

          <div className="flex justify-between px-6 py-4 border-t border-outline-variant/10">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
              className="px-4 py-2 text-sm font-medium text-error hover:bg-error/10 rounded-lg transition-all disabled:opacity-50"
            >
              Delete Note
            </button>
            <div className="flex gap-2">
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

          {/* Delete Confirmation */}
          {showDeleteConfirm && (
            <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center p-6">
              <div className="bg-white rounded-xl p-6 shadow-xl max-w-sm">
                <h3 className="text-lg font-bold text-error mb-2">Delete Note?</h3>
                <p className="text-sm text-on-surface-variant mb-4">
                  This action cannot be undone. The note will be permanently deleted.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false)
                      handleDelete()
                    }}
                    disabled={deleting}
                    className="px-4 py-2 bg-error text-white text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
                  >
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
