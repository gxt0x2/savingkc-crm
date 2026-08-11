'use client'

import { useState, useRef } from 'react'
import { Icon } from '@/components/ui/icon'

interface EditTaskModalProps {
  taskId: string
  initialTitle: string
  initialMetadata: {
    task_type?: string
    due_date?: string
    assigned_to?: string
    notes?: string
    status?: string
    priority?: string
    source?: string
  }
  onClose: () => void
  onSaved: (taskId: string, newTitle: string, newMetadata: Record<string, unknown>) => void
  onDeleted?: (taskId: string) => void
}

export function EditTaskModal({
  taskId,
  initialTitle,
  initialMetadata,
  onClose,
  onSaved,
  onDeleted
}: EditTaskModalProps) {
  const [title, setTitle] = useState(initialTitle)
  const [taskType, setTaskType] = useState(initialMetadata.task_type || 'follow_up')
  const [dueDate, setDueDate] = useState(() => {
    if (initialMetadata.due_date) {
      const d = new Date(initialMetadata.due_date)
      return d.toISOString().slice(0, 16)
    }
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d.toISOString().slice(0, 16)
  })
  const [assignedTo, setAssignedTo] = useState(initialMetadata.assigned_to || 'Casey')
  const [notes, setNotes] = useState(initialMetadata.notes || '')
  const [status, setStatus] = useState(initialMetadata.status || 'pending')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)

    try {
      const res = await fetch(`/api/calendar/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          taskType,
          dueDate: new Date(dueDate).toISOString(),
          assignedTo: assignedTo || null,
          status: status === 'completed' ? 'completed' : 'pending',
          notes: notes.trim(),
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        console.error('Failed to update task:', data.error)
        alert('Failed to update task')
        return
      }

      onSaved(taskId, title.trim(), {
        task_type: taskType,
        due_date: new Date(dueDate).toISOString(),
        assigned_to: assignedTo || null,
        status,
        notes: notes.trim(),
      })
      onClose()
    } catch (err) {
      console.error('Error updating task:', err)
      alert('Failed to update task')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)

    try {
      const res = await fetch(`/api/calendar/tasks/${taskId}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        console.error('Failed to delete task:', data.error)
        alert('Failed to delete task')
        return
      }

      onDeleted?.(taskId)
      onClose()
    } catch (err) {
      console.error('Error deleting task:', err)
      alert('Failed to delete task')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        className="crm-panel-raised relative w-full max-w-md overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="border-b border-[var(--crm-border)] px-6 pb-4 pt-6">
          <div className="flex items-center gap-2">
            <Icon name="task_alt" className="text-[var(--crm-brand)]" />
            <h2 className="text-xl font-black text-[var(--crm-ink)]">Edit task</h2>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Title</label>
            <input
              ref={titleRef}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow up with seller, Run comps..."
              className="crm-field w-full rounded-lg px-3 py-2 text-sm outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Type</label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                className="crm-field w-full rounded-lg px-3 py-2 text-sm"
              >
                <option value="follow_up">Follow-up</option>
                <option value="callback">Callback</option>
                <option value="appointment">Appointment</option>
                <option value="research">Research</option>
                <option value="offer">Send Offer</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="crm-field w-full rounded-lg px-3 py-2 text-sm"
              >
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Assigned To</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="crm-field w-full rounded-lg px-3 py-2 text-sm"
              >
                <option value="Casey">Casey</option>
                <option value="Ernest">Ernest</option>
                <option value="Gertha">Gertha</option>
                <option value="">Unassigned</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Due Date</label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="crm-field w-full rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
              Notes <span className="font-medium text-[var(--crm-text-dim)]">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={2}
              className="crm-field w-full resize-none rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-between border-t border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-6 py-4">
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleting}
            className="rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-4 py-2 text-sm font-bold text-[var(--crm-danger)] disabled:opacity-50"
          >
            Delete Task
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="crm-primary-button flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-bold disabled:opacity-40"
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
          <div className="absolute inset-0 bg-black/70 rounded-xl flex items-center justify-center p-6">
            <div className="crm-panel-raised max-w-sm rounded-xl p-6 shadow-xl">
              <h3 className="mb-2 text-lg font-bold text-[var(--crm-danger)]">Delete task?</h3>
              <p className="mb-4 text-sm text-[var(--crm-text-muted)]">
                This action cannot be undone. The task will be permanently deleted.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    handleDelete()
                  }}
                  disabled={deleting}
                  className="rounded-lg bg-[var(--crm-danger)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
