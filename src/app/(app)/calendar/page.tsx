'use client'

import { useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ViewToggle, type CalendarView } from '@/components/calendar/view-toggle'
import { MonthView } from '@/components/calendar/month-view'
import { WeekView } from '@/components/calendar/week-view'
import { AgendaView } from '@/components/calendar/agenda-view'
import { DayView } from '@/components/calendar/day-view'
import { NewTaskModal } from '@/components/modals/new-task-modal'
import { EditTaskModal } from '@/components/modals/edit-task-modal'
import { useCalendarTasks } from '@/hooks/use-calendar-tasks'
import { toProperCase } from '@/lib/format'
import type { Task } from '@/types'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function CalendarContent() {
  const searchParams = useSearchParams()
  const viewParam = (searchParams.get('view') || 'month') as CalendarView

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const { data: tasks = [], isLoading } = useCalendarTasks()

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showNewTask, setShowNewTask] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

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
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setSelectedTask(null)}
        >
          <div
            className="ck-card w-full max-w-md shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--ck-border)]">
              <h2 className="font-black text-lg text-[var(--ck-text)] leading-tight">{selectedTask.title}</h2>
              <button
                onClick={() => setSelectedTask(null)}
                className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Body: label + value rows */}
            <div className="px-5 py-4 space-y-2.5">
              <DetailRow label="Type">
                <span className="capitalize text-[var(--ck-text)]">{selectedTask.type.replace(/_/g, ' ')}</span>
              </DetailRow>
              {selectedTask.due_date && (
                <DetailRow label="Due">
                  <span className="text-[var(--ck-text)] tabular-nums">
                    {new Date(selectedTask.due_date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </DetailRow>
              )}
              {selectedTask.description && (
                <DetailRow label="Details">
                  <span className="text-[var(--ck-text)] leading-relaxed">{selectedTask.description}</span>
                </DetailRow>
              )}
              {selectedTask.contact && (
                <DetailRow label="Contact">
                  <span className="text-[var(--ck-text)]">
                    {toProperCase(selectedTask.contact.first_name || '')} {toProperCase(selectedTask.contact.last_name || '')}
                  </span>
                </DetailRow>
              )}
              {selectedTask.property_address && (
                <DetailRow label="Property">
                  <span className="text-[var(--ck-text)]">{selectedTask.property_address}</span>
                </DetailRow>
              )}
              {selectedTask.assigned_to && (
                <DetailRow label="Assigned">
                  <span className="text-[var(--ck-text)]">{selectedTask.assigned_to}</span>
                </DetailRow>
              )}
              <DetailRow label="Status">
                {selectedTask.status === 'overdue' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#E32E2E]/20 text-[#FCA5A5] text-[11px] font-black uppercase tracking-wider">
                    Overdue
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-yellow-400/15 text-yellow-300 text-[11px] font-black uppercase tracking-wider">
                    {selectedTask.status}
                  </span>
                )}
              </DetailRow>
            </div>

            {/* Actions */}
            <div className="px-5 py-4 border-t border-[var(--ck-border)] flex gap-2">
              <button
                onClick={() => {
                  setEditingTask(selectedTask)
                  setSelectedTask(null)
                }}
                className="flex-1 py-2.5 bg-[var(--ck-surface-elev)] hover:bg-[var(--ck-surface-hi)] border border-[var(--ck-border)] text-[var(--ck-text)] rounded-lg font-bold text-sm transition-colors"
              >
                Edit Task
              </button>
              {selectedTask.contact_id && (
                <a
                  href={`/leads/${selectedTask.contact_id}`}
                  className="flex-1 text-center py-2.5 bg-[#E32E2E] hover:bg-[#C42626] text-white rounded-lg font-bold text-sm transition-colors"
                >
                  View Lead Profile →
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onCreated={() => { setShowNewTask(false); window.location.reload() }}
          showLeadSelector={true}
        />
      )}

      {editingTask && (
        <EditTaskModal
          taskId={editingTask.id}
          initialTitle={editingTask.title}
          initialMetadata={{
            task_type: editingTask.type,
            due_date: editingTask.due_date || undefined,
            assigned_to: editingTask.assigned_to || undefined,
            notes: editingTask.description || undefined,
            status: editingTask.status === 'overdue' ? 'pending' : editingTask.status,
            priority: 'normal',
            source: 'calendar'
          }}
          onClose={() => setEditingTask(null)}
          onSaved={() => {
            setEditingTask(null)
            window.location.reload()
          }}
          onDeleted={() => {
            setEditingTask(null)
            window.location.reload()
          }}
        />
      )}
    </>
  )
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[var(--ck-text-muted)]">Loading calendar...</div>}>
      <CalendarContent />
    </Suspense>
  )
}

// ─── Label + value row — dim label, bright value ──────────────────
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-20 flex-shrink-0 text-[10px] font-black uppercase tracking-[0.15em] text-[var(--ck-text-muted)]">
        {label}
      </span>
      <div className="flex-1 min-w-0 text-sm">{children}</div>
    </div>
  )
}
