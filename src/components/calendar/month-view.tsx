'use client'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { Task } from '@/types'

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const cells: { day: number; isCurrentMonth: boolean; date: Date }[] = []

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    cells.push({ day: d, isCurrentMonth: false, date: new Date(year, month - 1, d) })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, isCurrentMonth: true, date: new Date(year, month, d) })
  }

  const remaining = 7 - (cells.length % 7)
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, isCurrentMonth: false, date: new Date(year, month + 1, d) })
    }
  }

  return cells
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function taskColorClasses(task: Task) {
  if (task.status === 'overdue') {
    return {
      bg: 'bg-error-container/40',
      border: 'border-error',
      text: 'text-on-error-container',
    }
  }
  switch (task.type) {
    case 'appointment':
    case 'follow_up':
      return {
        bg: 'bg-secondary-container/30',
        border: 'border-secondary',
        text: 'text-on-secondary-container',
      }
    case 'send_offer':
      return {
        bg: 'bg-primary-fixed/40',
        border: 'border-primary',
        text: 'text-on-primary-fixed',
      }
    case 'review':
    case 'task':
      return {
        bg: 'bg-surface-container-highest',
        border: 'border-outline',
        text: 'text-on-surface-variant',
      }
    default:
      return {
        bg: 'bg-surface-container-highest',
        border: 'border-outline',
        text: 'text-on-surface-variant',
      }
  }
}

function taskTypeLabel(task: Task) {
  if (task.status === 'overdue') return 'OVERDUE'
  switch (task.type) {
    case 'follow_up': return 'Follow-up'
    case 'appointment': return 'Appointment'
    case 'send_offer': return 'Send Offer'
    case 'review': return 'Review Comps'
    case 'task': return 'Task'
    default: return task.type
  }
}

export function MonthView({
  year,
  month,
  tasks,
  onTaskClick,
}: {
  year: number
  month: number
  tasks: Task[]
  onTaskClick?: (task: Task) => void
}) {
  const cells = getMonthGrid(year, month)
  const today = new Date()

  function getTasksForDate(date: Date) {
    return tasks.filter((t) => {
      if (!t.due_date) return false
      const d = new Date(t.due_date)
      return isSameDay(d, date)
    })
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-[0px_8px_24px_rgba(25,28,29,0.06)] overflow-hidden">
      {/* Days of week header */}
      <div className="grid grid-cols-7 border-b border-outline-variant/10 bg-surface-container-low/50">
        {DAYS_OF_WEEK.map((day) => (
          <div key={day} className="py-3 text-center text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 min-h-[700px]">
        {cells.map((cell, idx) => {
          const isToday = cell.isCurrentMonth && isSameDay(cell.date, today)
          const cellTasks = getTasksForDate(cell.date)
          const isLastRow = idx >= cells.length - 7
          const isLastCol = (idx + 1) % 7 === 0

          return (
            <div
              key={idx}
              className={cn(
                'p-2 group hover:bg-surface-container-low transition-colors',
                !isLastCol && 'border-r border-outline-variant/10',
                !isLastRow && 'border-b border-outline-variant/10',
                !cell.isCurrentMonth && 'bg-surface-container-low/20 opacity-50',
                isToday && 'bg-surface-container-low'
              )}
            >
              {isToday ? (
                <span className="text-xs font-bold bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center -mt-0.5 -ml-0.5">
                  {cell.day}
                </span>
              ) : (
                <span className={cn('text-xs font-bold', cell.isCurrentMonth ? 'text-on-surface' : 'text-on-surface-variant')}>
                  {cell.day}
                </span>
              )}

              {cellTasks.slice(0, 2).map((task) => {
                const colors = taskColorClasses(task)
                return (
                  <div
                    key={task.id}
                    onClick={(e) => { e.stopPropagation(); onTaskClick?.(task) }}
                    className={cn(
                      'mt-2 p-1.5 border-l-4 text-[10px] font-bold rounded-sm flex flex-col gap-0.5',
                      colors.bg,
                      colors.border,
                      colors.text,
                      'cursor-pointer hover:opacity-80'
                    )}
                  >
                    {task.status === 'overdue' && (
                      <span className="flex items-center gap-1">
                        <Icon name="priority_high" size="text-[12px]" /> OVERDUE
                      </span>
                    )}
                    <span className="truncate">
                      {task.status !== 'overdue' && `${taskTypeLabel(task)}: `}
                      {task.title}
                    </span>
                    {task.assigned_to && (
                      <div className="flex mt-0.5 -space-x-1">
                        <div className="w-4 h-4 rounded-full bg-slate-200 border border-white flex items-center justify-center text-[8px] text-slate-700">
                          {task.assigned_to.slice(0, 2).toUpperCase()}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {cellTasks.length > 2 && (
                <div className="mt-1 text-[9px] font-semibold text-on-surface-variant">
                  +{cellTasks.length - 2} more
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
