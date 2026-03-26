'use client'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { Task } from '@/types'

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function statusDotColor(task: Task) {
  if (task.status === 'overdue') return 'bg-error'
  switch (task.type) {
    case 'appointment':
    case 'follow_up':
      return 'bg-secondary'
    case 'send_offer':
      return 'bg-primary'
    case 'review':
    case 'task':
      return 'bg-outline'
    default:
      return 'bg-outline'
  }
}

function taskTypeLabel(task: Task) {
  switch (task.type) {
    case 'follow_up': return 'Follow-up Call'
    case 'appointment': return 'Appointment'
    case 'send_offer': return 'Send Offer'
    case 'review': return 'Review Comps'
    case 'task': return 'Task'
    default: return task.type
  }
}

function taskTypeColor(task: Task) {
  if (task.status === 'overdue') return 'text-error'
  switch (task.type) {
    case 'appointment':
    case 'follow_up':
      return 'text-secondary'
    case 'send_offer':
      return 'text-primary'
    case 'review':
    case 'task':
      return 'text-outline'
    default:
      return 'text-outline'
  }
}

function formatDueDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

function formatDueTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

interface AgendaSection {
  label: string
  tasks: Task[]
  isOverdue?: boolean
}

function groupTasksIntoSections(tasks: Task[]): AgendaSection[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const overdue: Task[] = []
  const todayTasks: Task[] = []
  const tomorrowTasks: Task[] = []
  const upcoming: Task[] = []

  for (const task of tasks) {
    if (task.status === 'overdue') {
      overdue.push(task)
      continue
    }
    if (!task.due_date) {
      upcoming.push(task)
      continue
    }
    const d = new Date(task.due_date)
    if (isSameDay(d, today)) {
      todayTasks.push(task)
    } else if (isSameDay(d, tomorrow)) {
      tomorrowTasks.push(task)
    } else {
      upcoming.push(task)
    }
  }

  const sections: AgendaSection[] = []
  if (overdue.length > 0) {
    sections.push({ label: 'Overdue Items', tasks: overdue, isOverdue: true })
  }

  const todayStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  if (todayTasks.length > 0) {
    sections.push({ label: `Today - ${todayStr}`, tasks: todayTasks })
  }

  const tomorrowStr = tomorrow.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  if (tomorrowTasks.length > 0) {
    sections.push({ label: `Tomorrow - ${tomorrowStr}`, tasks: tomorrowTasks })
  }

  if (upcoming.length > 0) {
    sections.push({ label: 'Upcoming', tasks: upcoming })
  }

  return sections
}

function AgendaRow({ task }: { task: Task }) {
  const isOverdue = task.status === 'overdue'
  return (
    <div className={cn(
      'grid grid-cols-12 gap-4 px-6 py-4 items-center transition-colors group',
      isOverdue ? 'hover:bg-error-container/10' : 'hover:bg-surface-container-low/50'
    )}>
      <div className="col-span-1">
        <span className={cn('w-2 h-2 rounded-full inline-block', statusDotColor(task))} />
      </div>
      <div className="col-span-2">
        <span className={cn('text-xs font-bold', taskTypeColor(task))}>
          {taskTypeLabel(task)}
        </span>
      </div>
      <div className="col-span-5">
        <div className="text-sm font-semibold text-on-surface group-hover:underline cursor-pointer">
          {task.property_address || task.title}
        </div>
        {task.description && (
          <div className="text-[10px] text-on-surface-variant">{task.description}</div>
        )}
        {task.contact && (
          <div className="text-[10px] text-on-surface-variant">
            Lead: {task.contact.first_name} {task.contact.last_name}
          </div>
        )}
      </div>
      <div className="col-span-2">
        {task.due_date && (
          <>
            <div className={cn('text-xs font-bold', isOverdue ? 'text-error' : '')}>
              {isOverdue ? formatDueDate(task.due_date) : isSameDay(new Date(task.due_date), new Date()) ? 'Today' : formatDueDate(task.due_date)}
            </div>
            <div className="text-[10px] text-on-surface-variant">{formatDueTime(task.due_date)}</div>
          </>
        )}
      </div>
      <div className="col-span-2 flex justify-end">
        {task.assigned_to && (
          <div className="w-6 h-6 rounded-full bg-primary-fixed text-on-primary-fixed flex items-center justify-center text-[10px] font-bold">
            {task.assigned_to.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
    </div>
  )
}

export function AgendaView({ tasks }: { tasks: Task[] }) {
  const sections = groupTasksIntoSections(tasks)

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-[0px_8px_24px_rgba(25,28,29,0.06)] border border-outline-variant/10 flex flex-col max-h-[calc(100vh-280px)]">
      {/* Column header */}
      <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-outline-variant/15 bg-surface-container-low/50 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
        <div className="col-span-1">Status</div>
        <div className="col-span-2">Task Type</div>
        <div className="col-span-5">Associated Property / Lead</div>
        <div className="col-span-2">Due Date &amp; Time</div>
        <div className="col-span-2 text-right">Assigned</div>
      </div>

      {/* Scrollable agenda body */}
      <div className="overflow-y-auto flex-grow divide-y divide-outline-variant/5">
        {sections.map((section) => (
          <div key={section.label} className={section.isOverdue ? 'bg-error-container/5' : ''}>
            <div className={cn(
              'px-6 py-2 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2',
              section.isOverdue
                ? 'bg-error/5 text-error'
                : 'bg-surface-container-low text-on-surface-variant'
            )}>
              {section.isOverdue && <Icon name="warning" size="text-xs" />}
              {section.label}
            </div>
            {section.tasks.map((task) => (
              <AgendaRow key={task.id} task={task} />
            ))}
          </div>
        ))}

        {sections.length === 0 && (
          <div className="px-6 py-12 text-center text-on-surface-variant text-sm">
            No tasks scheduled.
          </div>
        )}
      </div>
    </div>
  )
}
