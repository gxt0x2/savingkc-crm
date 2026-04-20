'use client'

import { Icon } from '@/components/ui/icon'
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

// Task type → dark-theme chip treatment. Each tone uses a translucent tinted
// background plus a solid left rail in the same hue so tasks remain scannable
// against the dark grid. Colors pass the "no emoji, keep status signals"
// rule — overdue red, appointment emerald, follow-up amber, etc.
function taskChipStyle(task: Task) {
  if (task.status === 'overdue') {
    return 'bg-[#E32E2E]/15 border-l-2 border-[#E32E2E] text-[#FCA5A5]'
  }
  switch (task.type) {
    case 'appointment':
      return 'bg-emerald-500/12 border-l-2 border-emerald-500 text-emerald-200'
    case 'follow_up':
      return 'bg-amber-500/12 border-l-2 border-amber-500 text-amber-100'
    case 'send_offer':
      return 'bg-violet-500/15 border-l-2 border-violet-500 text-violet-200'
    case 'review':
    case 'task':
    default:
      return 'bg-white/5 border-l-2 border-[var(--ck-border-strong)] text-[var(--ck-text)]'
  }
}

function taskTypeLabel(task: Task) {
  if (task.status === 'overdue') return 'Overdue'
  switch (task.type) {
    case 'follow_up': return 'Follow-up'
    case 'appointment': return 'Appt'
    case 'send_offer': return 'Offer'
    case 'review': return 'Review'
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
      return isSameDay(new Date(t.due_date), date)
    })
  }

  return (
    <div className="ck-card overflow-hidden">
      {/* Days of week header */}
      <div className="grid grid-cols-7 border-b border-[var(--ck-border)] bg-[var(--ck-surface-elev)]">
        {DAYS_OF_WEEK.map((day) => (
          <div key={day} className="py-2.5 text-center text-[10px] font-black uppercase tracking-[0.2em] text-[var(--ck-text-muted)]">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 auto-rows-[minmax(110px,1fr)]">
        {cells.map((cell, idx) => {
          const isToday = cell.isCurrentMonth && isSameDay(cell.date, today)
          const cellTasks = getTasksForDate(cell.date)
          const isLastRow = idx >= cells.length - 7
          const isLastCol = (idx + 1) % 7 === 0

          return (
            <div
              key={idx}
              className={[
                'relative p-2 group transition-colors',
                !isLastCol && 'border-r border-[var(--ck-border)]',
                !isLastRow && 'border-b border-[var(--ck-border)]',
                !cell.isCurrentMonth && 'opacity-40',
                isToday ? 'bg-[#E32E2E]/5' : 'hover:bg-white/[0.03]',
              ].filter(Boolean).join(' ')}
            >
              {/* Day number */}
              <div className="flex items-center justify-between mb-1.5">
                {isToday ? (
                  <span className="text-[11px] font-black bg-[#E32E2E] text-white w-6 h-6 rounded-full flex items-center justify-center tabular-nums">
                    {cell.day}
                  </span>
                ) : (
                  <span className={`text-[11px] font-bold tabular-nums ${cell.isCurrentMonth ? 'text-[var(--ck-text)]' : 'text-[var(--ck-text-dim)]'}`}>
                    {cell.day}
                  </span>
                )}
                {cellTasks.length > 0 && !isToday && (
                  <span className="text-[9px] font-bold text-[var(--ck-text-dim)] tabular-nums">
                    {cellTasks.length}
                  </span>
                )}
              </div>

              {/* Task chips — show up to 3 */}
              <div className="space-y-1">
                {cellTasks.slice(0, 3).map((task) => (
                  <button
                    key={task.id}
                    onClick={(e) => { e.stopPropagation(); onTaskClick?.(task) }}
                    className={`w-full px-1.5 py-1 text-left text-[10px] font-semibold rounded-sm flex items-center gap-1 truncate hover:brightness-125 transition-all ${taskChipStyle(task)}`}
                  >
                    {task.status === 'overdue' && (
                      <Icon name="priority_high" size="text-[10px]" className="flex-shrink-0" />
                    )}
                    <span className="uppercase tracking-wider text-[8px] font-black opacity-70 flex-shrink-0">
                      {taskTypeLabel(task)}
                    </span>
                    <span className="truncate">{task.title}</span>
                  </button>
                ))}
                {cellTasks.length > 3 && (
                  <div className="text-[9px] font-bold text-[var(--ck-text-muted)] pl-1.5">
                    +{cellTasks.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
