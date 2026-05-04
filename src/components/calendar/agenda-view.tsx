'use client'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { taskAccentColor, taskDotStyle, taskTypeLabel } from '@/components/calendar/task-tone'
import type { Task } from '@/types'

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
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

function AgendaRow({ task, onTaskClick }: { task: Task; onTaskClick?: (task: Task) => void }) {
  const isOverdue = task.status === 'overdue'
  return (
    <button
      type="button"
      onClick={() => onTaskClick?.(task)}
      className={cn(
        'w-full grid grid-cols-12 gap-4 px-6 py-4 items-center text-left transition-colors group cursor-pointer',
        isOverdue ? 'hover:bg-[#E32E2E]/5' : 'hover:bg-[var(--ck-surface-elev)]'
      )}
    >
      <div className="col-span-1">
        <span className="w-2 h-2 rounded-full inline-block" style={taskDotStyle(task)} />
      </div>
      <div className="col-span-2">
        <span className="text-xs font-bold" style={{ color: taskAccentColor(task) }}>
          {taskTypeLabel(task)}
        </span>
      </div>
      <div className="col-span-5">
        <div className="text-sm font-semibold text-[var(--ck-text)] group-hover:underline cursor-pointer">
          {task.property_address || task.title}
        </div>
        {task.description && (
          <div className="text-[10px] text-[var(--ck-text-muted)]">{task.description}</div>
        )}
        {task.contact && (
          <div className="text-[10px] text-[var(--ck-text-muted)]">
            Lead: {task.contact.first_name} {task.contact.last_name}
          </div>
        )}
      </div>
      <div className="col-span-2">
        {task.due_date && (
          <>
            <div className="text-xs font-bold text-[var(--ck-text)]" style={isOverdue ? { color: taskAccentColor(task) } : undefined}>
              {isOverdue ? formatDueDate(task.due_date) : isSameDay(new Date(task.due_date), new Date()) ? 'Today' : formatDueDate(task.due_date)}
            </div>
            <div className="text-[10px] text-[var(--ck-text-muted)]">{formatDueTime(task.due_date)}</div>
          </>
        )}
      </div>
      <div className="col-span-2 flex justify-end">
        {task.assigned_to && (
          <div
            className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[10px] font-bold"
            style={{ backgroundColor: taskAccentColor(task) }}
          >
            {task.assigned_to.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
    </button>
  )
}

export function AgendaView({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick?: (task: Task) => void }) {
  const sections = groupTasksIntoSections(tasks)

  return (
    <div className="ck-card flex flex-col max-h-[calc(100vh-280px)] shadow-[0px_8px_24px_rgba(25,28,29,0.06)]">
      <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[10px] font-bold uppercase tracking-widest text-[var(--ck-text-muted)]">
        <div className="col-span-1">Status</div>
        <div className="col-span-2">Task Type</div>
        <div className="col-span-5">Associated Property / Lead</div>
        <div className="col-span-2">Due Date &amp; Time</div>
        <div className="col-span-2 text-right">Assigned</div>
      </div>

      <div className="overflow-y-auto flex-grow divide-y divide-[var(--ck-border)]">
        {sections.map((section) => (
          <div key={section.label} className={section.isOverdue ? 'bg-[#E32E2E]/5' : ''}>
            <div className={cn(
              'px-6 py-2 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2',
              section.isOverdue
                ? 'bg-[#E32E2E]/5 text-[#E32E2E]'
                : 'bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]'
            )}>
              {section.isOverdue && <Icon name="warning" size="text-xs" />}
              {section.label}
            </div>
            {section.tasks.map((task) => (
              <AgendaRow key={task.id} task={task} onTaskClick={onTaskClick} />
            ))}
          </div>
        ))}

        {sections.length === 0 && (
          <div className="px-6 py-12 text-center text-[var(--ck-text-muted)] text-sm">
            No tasks scheduled.
          </div>
        )}
      </div>
    </div>
  )
}
