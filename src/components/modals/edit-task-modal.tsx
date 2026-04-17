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
}

export function EditTaskModal({
  taskId,
  initialTitle,
  initialMetadata,
  onClose,
  onSaved
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
  const titleRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)

    try {
      const metadata = {
        task_type: taskType,
        due_date: new Date(dueDate).toISOString(),
        assigned_to: assignedTo,
        priority: initialMetadata.priority || 'normal',
        status,
        notes: notes.trim() || undefined,
        source: initialMetadata.source || 'lead_detail_task',
      }

      const res = await fetch(`/api/leads/activities/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: title.trim(),
          metadata,
          activity_type: 'task'
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        console.error('Failed to update task:', data.error)
        alert('Failed to update task')
        return
      }

      onSaved(taskId, title.trim(), metadata)
      onClose()
    } catch (err) {
      console.error('Error updating task:', err)
      alert('Failed to update task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        className="bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="px-6 pt-6 pb-4 border-b border-outline-variant/10">
          <div className="flex items-center gap-2">
            <Icon name="task_alt" className="text-primary" />
            <h2 className="text-lg font-black text-primary">Edit Task</h2>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Title</label>
            <input
              ref={titleRef}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow up with seller, Run comps..."
              className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Type</label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
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
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Assigned To</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
              >
                <option value="Casey">Casey</option>
                <option value="Ernest">Ernest</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Due Date</label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">
              Notes <span className="text-on-surface-variant/50">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={2}
              className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>
        <div className="px-6 py-4 bg-surface-container-high border-t border-outline-variant/10 flex justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="px-6 py-2 bg-primary text-on-primary font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-40 flex items-center gap-2"
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
      </form>
    </div>
  )
}
