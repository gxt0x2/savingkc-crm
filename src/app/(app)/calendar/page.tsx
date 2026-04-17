'use client'

import { useState, useCallback, Suspense, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ViewToggle, type CalendarView } from '@/components/calendar/view-toggle'
import { MonthView } from '@/components/calendar/month-view'
import { WeekView } from '@/components/calendar/week-view'
import { AgendaView } from '@/components/calendar/agenda-view'
import { DayView } from '@/components/calendar/day-view'
import { useCalendarTasks } from '@/hooks/use-calendar-tasks'
import type { Task } from '@/types'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function NewTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [taskType, setTaskType] = useState('follow_up')
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d.toISOString().slice(0, 16)
  })
  const [assignedTo, setAssignedTo] = useState('Casey')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)

    const supabase = createClient()
    const { error } = await supabase.from('lead_activities').insert({
      lead_id: null,
      activity_type: 'task',
      description: title.trim(),
      agent: assignedTo,
      metadata: {
        task_type: taskType,
        due_date: new Date(dueDate).toISOString(),
        assigned_to: assignedTo,
        priority: 'normal',
        status: 'pending',
        notes: notes.trim() || undefined,
        source: 'calendar_new_task',
      },
    })

    setSaving(false)
    if (!error) onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        className="bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="px-6 pt-6 pb-4 border-b border-outline-variant/10">
          <h2 className="text-lg font-black text-primary">New Task</h2>
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
              <select value={taskType} onChange={(e) => setTaskType(e.target.value)} className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm">
                <option value="follow_up">Follow-up</option>
                <option value="callback">Callback</option>
                <option value="appointment">Appointment</option>
                <option value="research">Research</option>
                <option value="offer">Send Offer</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Assigned To</label>
              <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm">
                <option value="Casey">Casey</option>
                <option value="Ernest">Ernest</option>
              </select>
            </div>
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
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Notes <span className="text-on-surface-variant/50">(optional)</span></label>
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
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container rounded-lg">Cancel</button>
          <button type="submit" disabled={saving || !title.trim()} className="px-6 py-2 bg-primary text-on-primary font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-40">
            {saving ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  )
}

function CalendarContent() {
  const searchParams = useSearchParams()
  const viewParam = (searchParams.get('view') || 'month') as CalendarView

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const { data: tasks = [], isLoading } = useCalendarTasks()

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showNewTask, setShowNewTask] = useState(false)

  function handleTaskClick(task: Task) {
    setSelectedTask(task)
  }

  const handlePrevMonth = useCallback(() => {
    setMonth((prev) => {
      if (prev === 0) {
        setYear((y) => y - 1)
        return 11
      }
      return prev - 1
    })
  }, [])

  const handleNextMonth = useCallback(() => {
    setMonth((prev) => {
      if (prev === 11) {
        setYear((y) => y + 1)
        return 0
      }
      return prev + 1
    })
  }, [])

  if (isLoading) {
    return (
      <div className="px-8 py-16 text-center text-on-surface-variant">
        Loading calendar...
      </div>
    )
  }

  return (
    <>
      <ViewToggle
        currentView={viewParam}
        currentMonth={MONTH_NAMES[month]}
        currentYear={year}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        onNewTask={() => setShowNewTask(true)}
      />

      <main className="px-4 sm:px-6 lg:px-8 pb-32">
        {viewParam === 'month' && (
          <MonthView year={year} month={month} tasks={tasks} onTaskClick={handleTaskClick} />
        )}
        {viewParam === 'week' && (
          <WeekView year={year} month={month} tasks={tasks} onTaskClick={handleTaskClick} />
        )}
        {viewParam === 'agenda' && (
          <AgendaView tasks={tasks} onTaskClick={handleTaskClick} />
        )}
        {viewParam === 'day' && (
          <DayView year={year} month={month} tasks={tasks} onTaskClick={handleTaskClick} />
        )}
      </main>

      {selectedTask && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
          onClick={() => setSelectedTask(null)}
        >
          <div
            className="bg-white rounded-xl p-6 shadow-2xl w-96 max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h2 className="font-bold text-lg text-primary">{selectedTask.title}</h2>
              <button onClick={() => setSelectedTask(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div><span className="font-semibold text-slate-600">Type:</span> <span className="capitalize">{selectedTask.type.replace(/_/g, ' ')}</span></div>
              {selectedTask.due_date && (
                <div><span className="font-semibold text-slate-600">Due:</span> {new Date(selectedTask.due_date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              )}
              {selectedTask.description && (
                <div><span className="font-semibold text-slate-600">Details:</span> {selectedTask.description}</div>
              )}
              {selectedTask.contact && (
                <div><span className="font-semibold text-slate-600">Contact:</span> {selectedTask.contact.first_name} {selectedTask.contact.last_name}</div>
              )}
              {selectedTask.property_address && (
                <div><span className="font-semibold text-slate-600">Property:</span> {selectedTask.property_address}</div>
              )}
              {selectedTask.assigned_to && (
                <div><span className="font-semibold text-slate-600">Assigned:</span> {selectedTask.assigned_to}</div>
              )}
              <div><span className="font-semibold text-slate-600">Status:</span> <span className={selectedTask.status === 'overdue' ? 'text-red-600 font-bold' : ''}>{selectedTask.status}</span></div>
            </div>
            {selectedTask.contact_id && (
              <a
                href={`/leads/${selectedTask.contact_id}`}
                className="mt-4 block w-full text-center py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:opacity-90 transition-all"
              >
                View Lead Profile →
              </a>
            )}
          </div>
        </div>
      )}

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onCreated={() => { setShowNewTask(false); window.location.reload() }}
        />
      )}
    </>
  )
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="p-8 text-on-surface-variant">Loading calendar...</div>}>
      <CalendarContent />
    </Suspense>
  )
}
