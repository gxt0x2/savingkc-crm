'use client'

import { cn } from '@/lib/utils'
import { taskAccentColor, taskChipStyle, taskTypeLabel } from '@/components/calendar/task-tone'
import type { Task } from '@/types'

const HOURS = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM',
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function getWeekDates(year: number, month: number, referenceDay: number) {
  const ref = new Date(year, month, referenceDay)
  const dayOfWeek = ref.getDay()
  const sunday = new Date(ref)
  sunday.setDate(ref.getDate() - dayOfWeek)

  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    dates.push(d)
  }
  return dates
}

export function WeekView({
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
  const referenceDay = isCurrentMonth ? today.getDate() : 1
  const weekDates = getWeekDates(year, month, referenceDay)

  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()

  function getTasksForDayHour(date: Date, hour: number) {
    return tasks.filter((t) => {
      if (!t.due_date) return false
      const d = new Date(t.due_date)
      return isSameDay(d, date) && d.getHours() === hour
    })
  }

  return (
    <div className="ck-card overflow-hidden flex flex-col shadow-[0px_4px_16px_rgba(0,0,0,0.04)]">
      <div className="grid grid-cols-[80px_repeat(7,1fr)] border-b border-[var(--ck-border)] bg-[var(--ck-surface-elev)] sticky top-0 z-10">
        <div className="p-3 border-r border-[var(--ck-border)] flex items-center justify-center text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider">
          GMT-5
        </div>
        {weekDates.map((date, i) => {
          const isToday = isSameDay(date, today)
          return (
            <div
              key={i}
              className={cn(
                'p-3 text-center border-r border-[var(--ck-border)]',
                isToday && 'bg-[#E32E2E]/5'
              )}
            >
              <div className={cn(
                'text-[10px] font-bold uppercase tracking-widest',
                isToday ? 'text-[#E32E2E]' : 'text-[var(--ck-text-muted)]'
              )}>
                {DAY_LABELS[i]}
              </div>
              <div className={cn('text-lg font-bold text-[var(--ck-text)]', isToday && 'text-[#E32E2E]')}>
                {String(date.getDate()).padStart(2, '0')}
              </div>
            </div>
          )
        })}
      </div>

      {/* Time grid body */}
      <div className="overflow-y-auto max-h-[calc(100vh-320px)] relative">
        {HOURS.map((hourLabel, hourIdx) => {
          const hour = hourIdx + 8
          const isNoonRow = hour === 12

          return (
            <div
              key={hourLabel}
              className={cn(
                'grid grid-cols-[80px_repeat(7,1fr)] border-b border-[var(--ck-border)]',
                isNoonRow && 'bg-[var(--ck-surface-elev)]'
              )}
              style={{ minHeight: '100px' }}
            >
              <div className="text-[10px] font-medium text-[var(--ck-text-dim)] pt-2 text-right pr-3">
                {hourLabel}
              </div>
              {weekDates.map((date, dayIdx) => {
                const isToday = isSameDay(date, today)
                const dayTasks = getTasksForDayHour(date, hour)
                const showTimeLine = isToday && hour === currentHour

                return (
                  <div
                    key={dayIdx}
                    className={cn(
                      'border-r border-[var(--ck-border)] p-1 relative',
                      isToday && 'bg-[#E32E2E]/5'
                    )}
                  >
                    {showTimeLine && (
                      <div
                        className="absolute left-0 w-full h-[2px] bg-error z-20 opacity-60"
                        style={{ top: `${(currentMinute / 60) * 100}%` }}
                      />
                    )}
                    {dayTasks.map((task) => {
                      return (
                        <div
                          key={task.id}
                          onClick={() => onTaskClick?.(task)}
                          className="absolute inset-x-1 top-1 p-2 border-l-4 rounded-sm shadow-sm cursor-pointer hover:brightness-110 transition-all"
                          style={taskChipStyle(task)}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-[9px] font-extrabold uppercase">
                              {taskTypeLabel(task)}
                            </span>
                            {task.assigned_to && (
                              <div
                                className="w-4 h-4 rounded-full text-white flex items-center justify-center text-[8px] font-bold"
                                style={{ backgroundColor: taskAccentColor(task) }}
                              >
                                {task.assigned_to.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="text-[11px] font-bold leading-tight">
                            {task.title}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
