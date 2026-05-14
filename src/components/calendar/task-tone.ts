import type { CSSProperties } from 'react'
import type { Task } from '@/types'

function taskToneToken(task: Task) {
  if (task.status === 'overdue') return '--ck-accent'

  switch (task.type) {
    case 'appointment':
      return '--ck-success'
    case 'follow_up':
      return '--ck-warn'
    case 'send_offer':
      return '--ck-info'
    case 'review':
    case 'task':
    default:
      return '--ck-text-muted'
  }
}

export function taskAccentColor(task: Task) {
  return `var(${taskToneToken(task)})`
}

export function taskChipStyle(task: Task): CSSProperties {
  const color = taskAccentColor(task)

  // Chip bg alpha is theme-aware via --ck-chip-alpha (14% dark, 28% light).
  // Without this the chip is a faint haze on white surfaces.
  return {
    backgroundColor: `color-mix(in srgb, ${color} var(--ck-chip-alpha, 14%), transparent)`,
    borderLeftColor: color,
    color,
  }
}

export function taskDotStyle(task: Task): CSSProperties {
  return { backgroundColor: taskAccentColor(task) }
}

export function taskTypeLabel(task: Task) {
  if (task.status === 'overdue') return 'Overdue'

  switch (task.type) {
    case 'follow_up': return 'Follow-up'
    case 'appointment': return 'Appointment'
    case 'send_offer': return 'Offer'
    case 'review': return 'Review'
    case 'task': return 'Task'
    default: return task.type
  }
}
