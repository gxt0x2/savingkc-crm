'use client'

import { useState } from 'react'
import type { PilotThread } from '@/lib/email/workflow/types'
import { formatEmailTime } from '@/lib/email/workflow/presentation'
import styles from './email-workspace.module.css'

const kindLabel = (kind: string) =>
  ({
    follow_up: 'Follow-up',
    callback: 'Callback',
    appointment: 'Appointment',
    research: 'Research',
    task: 'Task',
    send_offer: 'Send offer',
  })[kind] ?? kind.replaceAll('_', ' ')

export function EmailCalendarAgenda({
  thread,
  asOf,
}: {
  thread: PilotThread
  asOf: string
}) {
  const [kind, setKind] = useState('')
  const [assignee, setAssignee] = useState('')
  const tasks = thread.open_tasks ?? []
  const types = Array.from(
    new Set([...tasks.map((task) => task.kind), ...(kind ? [kind] : [])]),
  ).sort()
  const agents = Array.from(
    new Set([
      ...tasks.map((task) => task.assigned_to ?? ''),
      ...(assignee ? [assignee === '__unassigned' ? '' : assignee] : []),
    ]),
  ).sort()
  const visible = tasks.filter(
    (task) =>
      (!kind || task.kind === kind) &&
      (!assignee || (task.assigned_to ?? '__unassigned') === assignee),
  )
  return (
    <section aria-label="Scheduled and upcoming work" className={styles.agenda}>
      <div className={styles.row}>
        <h4>Scheduled & upcoming</h4>
        <small>{thread.open_task_count ?? tasks.length} open</small>
      </div>
      <p className={styles.agendaScope}>For this Lead · Chicago time</p>
      {(tasks.length > 0 || kind || assignee) && (
        <div className={styles.agendaFilters}>
          <label>
            Type
            <select
              aria-label="Filter task type"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">All types</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {kindLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assigned to
            <select
              aria-label="Filter assignee"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">Everyone</option>
              {agents.map((agent) => (
                <option key={agent} value={agent || '__unassigned'}>
                  {agent || 'Unassigned'}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div
        className={styles.agendaItems}
        tabIndex={visible.length ? 0 : undefined}
        aria-label="Open tasks"
      >
        {visible.map((task) => {
          const overdue = task.due_at && new Date(task.due_at) < new Date(asOf)
          const status =
            task.status === 'blocked'
              ? 'Held — review before acting'
              : overdue
                ? 'Overdue'
                : task.due_at
                  ? 'Scheduled'
                  : 'Needs a date'
          return (
            <article key={task.key} className={styles.agendaItem}>
              <small
                className={
                  task.status === 'blocked' || overdue
                    ? styles.agendaAttention
                    : styles.agendaStatus
                }
              >
                {status}
              </small>
              <strong>{task.title}</strong>
              <span>
                {task.due_at ? formatEmailTime(task.due_at) : 'No due date'}
              </span>
              <small>
                {kindLabel(task.kind)} · {task.assigned_to ?? 'Unassigned'}
              </small>
              {task.kind === 'appointment' && (
                <small>
                  CRM appointment task · no Calendar booking verified
                </small>
              )}
              {task.notes && (
                <details>
                  <summary>Task notes</summary>
                  <p>{task.notes}</p>
                </details>
              )}
            </article>
          )
        })}
        {!visible.length && (
          <p>
            {!thread.lead_id
              ? 'Link the Lead to see its scheduled work.'
              : tasks.length
                ? 'No tasks match these filters.'
                : 'No open tasks for this Lead.'}
          </p>
        )}
      </div>
      {(thread.open_task_count ?? 0) > tasks.length && (
        <small>
          Showing the earliest {tasks.length} open tasks. These filters apply to
          the displayed set.
        </small>
      )}
      <small className={styles.calendarUnavailable}>
        Google Calendar events are not connected.
      </small>
    </section>
  )
}
