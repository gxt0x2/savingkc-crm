'use client'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
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

function getTaskHour(task: Task): number | null {
  if (!task.due_date) return null
  const d = new Date(task.due_date)
  return d.getHours()
}

function taskColorClasses(task: Task) {
  if (task.status === 'overdue') {
    return { bg: 'bg-error-container/40', border: 'border-error', label: 'text-error', text: 'text-on-error-container' }
  }
  switch (task.type) {
    case 'appointment':
    case 'follow_up':
      return { bg: 'bg-secondary-container/30', border: 'border-secondary', label: 'text-on-secondary-container', text: 'text-on-secondary-container' }
    case 'send_offer':
      return { bg: 'bg-primary-fixed', border: 'border-primary', label: 'text-primary', text: 'text-on-primary-fixed' }
    case 'review':
    case 'task':
      return { bg: 'bg-surface-container-highest', border: 'border-outline', label: 'text-on-surface-variant', text: 'text-on-surface-variant' }
    default:
      return { bg: 'bg-surface-container-highest', border: 'border-outline', label: 'text-on-surface-variant', text: 'text-on-surface-variant' }
  }
}

function taskTypeLabel(task: Task) {
  if (task.status === 'overdue') return 'Overdue'
  switch (task.type) {
    case 'follow_up': return 'Follow-up'
    case 'appointment': return 'Urgent Call'
    case 'send_offer': return 'Offer'
    case 'review': return 'Review'
    case 'task': return 'Task'
    default: return task.type
  }
}

function avatarBgColor(task: Task) {
  if (task.status === 'overdue') return 'bg-error'
  switch (task.type) {
    case 'appointment':
    case 'follow_up':
      return 'bg-secondary'
    case 'send_offer':
      return 'bg-primary'
    case 'review':
    case 'task':
      return 'bg-slate-400'
    default:
      return 'bg-slate-400'
  }
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
    <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_16px_rgba(0,0,0,0.04)] border border-outline-variant/20 overflow-hidden flex flex-col">
      {/* Header row with day names + dates */}
      <div className="grid grid-cols-[80px_repeat(7,1fr)] border-b border-outline-variant/20 bg-surface-container-low/30 sticky top-0 z-10">
        <div className="p-3 border-r border-outline-variant/10 flex items-center justify-center text-[10px] font-bold text-outline uppercase tracking-wider">
          GMT-5
        </div>
        {weekDates.map((date, i) => {
          const isToday = isSameDay(date, today)
          return (
            <div
              key={i}
              className={cn(
                'p-3 text-center border-r border-outline-variant/10',
                isToday && 'bg-primary-fixed/20'
              )}
            >
              <div className={cn(
                'text-[10px] font-bold uppercase tracking-widest',
                isToday ? 'text-primary' : 'text-on-surface-variant'
              )}>
                {DAY_LABELS[i]}
              </div>
              <div className={cn('text-lg font-bold', isToday && 'text-primary')}>
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
                'grid grid-cols-[80px_repeat(7,1fr)] border-b border-outline-variant/5',
                isNoonRow && 'bg-surface-container-low/20'
              )}
              style={{ minHeight: '100px' }}
            >
              <div className="text-[10px] font-medium text-outline pt-2 text-right pr-3">
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
                      'border-r border-outline-variant/5 p-1 relative',
                      isToday && 'bg-primary-fixed/5'
                    )}
                  >
                    {showTimeLine && (
                      <div
                        className="absolute left-0 w-full h-[2px] bg-error z-20 opacity-60"
                        style={{ top: `${(currentMinute / 60) * 100}%` }}
                      />
                    )}
                    {dayTasks.map((task) => {
                      const colors = taskColorClasses(task)
                      return (
                        <div
                          key={task.id}
                          onClick={() => onTaskClick?.(task)}
                          className={cn(
                            'absolute inset-x-1 top-1 p-2 border-l-4 rounded-sm shadow-sm cursor-pointer',
                            colors.bg,
                            colors.border
                          )}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className={cn('text-[9px] font-extrabold uppercase', colors.label)}>
                              {taskTypeLabel(task)}
                            </span>
                            {task.assigned_to && (
                              <div className={cn(
                                'w-4 h-4 rounded-full text-white flex items-center justify-center text-[8px] font-bold',
                                avatarBgColor(task)
                              )}>
                                {task.assigned_to.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className={cn('text-[11px] font-bold leading-tight', colors.text)}>
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
