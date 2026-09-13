'use client'

import { useRef, useState } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import type { PilotState } from '@/lib/email/workflow/types'
import styles from './email-workspace.module.css'

export function EmailNotifications({
  data,
  busy,
  act,
  openThread,
}: {
  data: PilotState
  busy: boolean
  act: (command: EmailCommand) => Promise<unknown>
  openThread: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const unread = data.notifications.filter((n) => !n.acknowledged_at)
  const visible = history ? data.notifications : unread
  return (
    <div
      className={styles.notificationsMenu}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        aria-expanded={open}
        aria-controls="email-notifications"
        onClick={() => setOpen(!open)}
      >
        Alerts{unread.length ? ` (${unread.length})` : ''}
      </button>
      {open && (
        <section
          id="email-notifications"
          aria-label="Your Email alerts"
          className={styles.notificationsPopover}
        >
          <div className={styles.row}>
            <strong>Your alerts</strong>
            <button
              aria-label="Close alerts"
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
              }}
            >
              ×
            </button>
          </div>
          <label className={styles.checkboxLine}>
            <input
              type="checkbox"
              checked={history}
              onChange={(e) => setHistory(e.target.checked)}
            />
            Show acknowledged
          </label>
          {visible.length ? (
            visible.map((n) => {
              const thread = data.threads.find((t) => t.id === n.thread_id)
              return (
                <article className={styles.notification} key={n.id}>
                  <strong>
                    {n.kind === 'team_member_work_held'
                      ? 'Team access changed — work needs review'
                      : n.kind}
                  </strong>
                  {thread ? (
                    <button
                      onClick={() => {
                        openThread(thread.id)
                        setOpen(false)
                      }}
                    >
                      Open {thread.name}
                    </button>
                  ) : (
                    <small>Conversation is outside your current view.</small>
                  )}
                  {n.acknowledged_at ? (
                    <small>Acknowledged</small>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() =>
                        act({
                          command: 'NTF-ACK',
                          idempotencyKey: crypto.randomUUID(),
                          payload: { eventId: n.id, eventRevision: 0 },
                        })
                      }
                    >
                      Acknowledge
                    </button>
                  )}
                </article>
              )
            })
          ) : (
            <p>No {history ? '' : 'unacknowledged '}alerts assigned to you.</p>
          )}
        </section>
      )}
    </div>
  )
}
