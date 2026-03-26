'use client'

import { cn } from '@/lib/utils'
import type { Task } from '@/types'

const HOURS = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM',
]

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function taskColorClasses(task: Task) {
  if (task.status === 'overdue') {
    return { bg: 'bg-error-container/40', border: 'border-error', text: 'text-on-error-container' }
  }
  switch (task.type) {
    case 'appointment':
    case 'follow_up':
      return { bg: 'bg-secondary-container/30', border: 'border-secondary', text: 'text-on-secondary-container' }
    case 'send_offer':
      return { bg: 'bg-primary-fixed/40', border: 'border-primary', text: 'text-on-primary-fixed' }
    default:
      return { bg: 'bg-surface-container-highest', border: 'border-outline', text: 'text-on-surface-variant' }
  }
}

function taskTypeLabel(task: Task) {
  switch (task.type) {
    case 'follow_up': return 'Follow-up'
    case 'appointment': return 'Appointment'
    case 'send_offer': return 'Send Offer'
    case 'review': return 'Review'
    case 'task': return 'Task'
    default: return task.type
  }
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
    <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_16px_rgba(0,0,0,0.04)] border border-outline-variant/20 overflow-hidden">
      {/* Day header */}
      <div className={cn(
        'px-6 py-4 border-b border-outline-variant/20',
        isToday ? 'bg-primary-fixed/20' : 'bg-surface-container-low/30'
      )}>
        <h2 className={cn('text-lg font-bold', isToday ? 'text-primary' : 'text-on-surface')}>
          {dayLabel}
        </h2>
      </div>

      {/* Time slots */}
      <div className="overflow-y-auto max-h-[calc(100vh-320px)]">
        {HOURS.map((hourLabel, hourIdx) => {
          const hour = hourIdx + 8
          const hourTasks = getTasksForHour(hour)
          const showTimeLine = isToday && hour === currentHour

          return (
            <div
              key={hourLabel}
              className="flex border-b border-outline-variant/5 relative"
              style={{ minHeight: '80px' }}
            >
              <div className="w-20 shrink-0 text-[10px] font-medium text-outline pt-3 text-right pr-4">
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
                  const colors = taskColorClasses(task)
                  return (
                    <div
                      key={task.id}
                      onClick={() => onTaskClick?.(task)}
                      className={cn(
                        'p-3 border-l-4 rounded-sm shadow-sm cursor-pointer hover:opacity-80 transition-opacity mb-2',
                        colors.bg,
                        colors.border
                      )}
                    >
                      <div className={cn('text-[9px] font-extrabold uppercase mb-1', colors.text)}>
                        {taskTypeLabel(task)}
                      </div>
                      <div className={cn('text-[12px] font-bold', colors.text)}>
                        {task.title}
                      </div>
                      {task.description && (
                        <div className="text-[10px] text-on-surface-variant mt-1">{task.description}</div>
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
