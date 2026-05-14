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
      // Callbacks / generic tasks: use the accent so chips read on light
      // surfaces. --ck-text-muted is slate-gray and disappears at any alpha.
      return '--ck-accent'
  }
}

export function taskAccentColor(task: Task) {
  return `var(${taskToneToken(task)})`
}

export function taskChipStyle(task: Task): CSSProperties {
  const color = taskAccentColor(task)

  // Theme-aware via CSS vars set in globals.css:
  //   --ck-chip-alpha     bg saturation (14% dark / 0% light)
  //   --ck-chip-mix-base  bg mix target (transparent dark / white light)
  //   --ck-chip-text      chip text override (accent dark / slate-900 light)
  // Per-chip accent is also exposed as --task-tone-label so the small
  // type label can render in the accent color while the chip body stays
  // neutral in light mode.
  return {
    backgroundColor: `color-mix(in srgb, ${color} var(--ck-chip-alpha, 14%), var(--ck-chip-mix-base, transparent))`,
    borderLeftColor: color,
    color: `var(--ck-chip-text, ${color})`,
    ['--task-tone-label' as string]: color,
  } as CSSProperties
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
