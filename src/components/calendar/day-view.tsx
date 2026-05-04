'use client'

import { cn } from '@/lib/utils'
import { taskChipStyle, taskTypeLabel } from '@/components/calendar/task-tone'
import type { Task } from '@/types'

const HOURS = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM',
]

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function DayView({
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
  const today = new Date()
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth()
  const dayDate = isCurrentMonth ? today : new Date(year, month, 1)

  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const isToday = isSameDay(dayDate, today)

  function getTasksForHour(hour: number): Task[] {
    return tasks.filter((t) => {
      if (!t.due_date) return false
      const d = new Date(t.due_date)
      return isSameDay(d, dayDate) && d.getHours() === hour
    })
  }

  const dayLabel = dayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="ck-card overflow-hidden shadow-[0px_4px_16px_rgba(0,0,0,0.04)]">
      <div className={cn(
        'px-6 py-4 border-b border-[var(--ck-border)]',
        isToday ? 'bg-[#E32E2E]/5' : 'bg-[var(--ck-surface-elev)]'
      )}>
        <h2 className={cn('text-lg font-bold', isToday ? 'text-[#E32E2E]' : 'text-[var(--ck-text)]')}>
          {dayLabel}
        </h2>
      </div>

      <div className="overflow-y-auto max-h-[calc(100vh-320px)]">
        {HOURS.map((hourLabel, hourIdx) => {
          const hour = hourIdx + 8
          const hourTasks = getTasksForHour(hour)
          const showTimeLine = isToday && hour === currentHour

          return (
            <div
              key={hourLabel}
              className="flex border-b border-[var(--ck-border)] relative"
              style={{ minHeight: '80px' }}
            >
              <div className="w-20 shrink-0 text-[10px] font-medium text-[var(--ck-text-dim)] pt-3 text-right pr-4">
                {hourLabel}
              </div>
              <div className="flex-1 p-2 relative">
                {showTimeLine && (
                  <div
                    className="absolute left-0 w-full h-[2px] bg-error z-20 opacity-60"
                    style={{ top: `${(currentMinute / 60) * 100}%` }}
                  />
                )}
                {hourTasks.map((task) => {
                  return (
                    <div
                      key={task.id}
                      onClick={() => onTaskClick?.(task)}
                      className="p-3 border-l-4 rounded-sm shadow-sm cursor-pointer hover:brightness-110 transition-all mb-2"
                      style={taskChipStyle(task)}
                    >
                      <div className="text-[9px] font-extrabold uppercase mb-1">
                        {taskTypeLabel(task)}
                      </div>
                      <div className="text-[12px] font-bold">
                        {task.title}
                      </div>
                      {task.description && (
                        <div className="text-[10px] text-[var(--ck-text-muted)] mt-1">{task.description}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
