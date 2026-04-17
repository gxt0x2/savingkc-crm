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
                <div><span className="font-semibold text-slate-600">Contact:</span> {toProperCase(selectedTask.contact.first_name || '')} {toProperCase(selectedTask.contact.last_name || '')}</div>
              )}
              {selectedTask.property_address && (
                <div><span className="font-semibold text-slate-600">Property:</span> {selectedTask.property_address}</div>
              )}
              {selectedTask.assigned_to && (
                <div><span className="font-semibold text-slate-600">Assigned:</span> {selectedTask.assigned_to}</div>
              )}
              <div><span className="font-semibold text-slate-600">Status:</span> <span className={selectedTask.status === 'overdue' ? 'text-red-600 font-bold' : ''}>{selectedTask.status}</span></div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setEditingTask(selectedTask)
                  setSelectedTask(null)
                }}
                className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200 transition-all"
              >
                Edit Task
              </button>
              {selectedTask.contact_id && (
                <a
                  href={`/leads/${selectedTask.contact_id}`}
                  className="flex-1 text-center py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:opacity-90 transition-all"
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
