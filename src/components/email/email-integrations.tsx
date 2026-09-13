'use client'

import { useState, type FormEvent } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import type { PilotState } from '@/lib/email/workflow/types'
import { defaultCallbackPolicy } from '@/lib/email/calendar'
import styles from './email-workspace.module.css'

const weekdayHours = defaultCallbackPolicy().hours

export function EmailIntegrations({
  data,
  busy,
  act,
  focus = 'all',
}: {
  data: PilotState
  busy: boolean
  act: (command: EmailCommand) => Promise<unknown>
  focus?: 'all' | 'calendar' | 'phone'
}) {
  const members = data.members
  const [agentId, setAgentId] = useState(members[0]?.id ?? '')
  const [numberId, setNumberId] = useState('')
  async function saveCalendar(event: FormEvent) {
    event.preventDefault()
    if (!agentId) return
    await act({
      command: 'SCH-POLICY',
      idempotencyKey: crypto.randomUUID(),
      payload: {
        enabled: false,
        agentCalendars: [agentId],
        hours: { ...weekdayHours },
        durationMinutes: 15,
        bufferMinutes: 10,
        maxDailyBookings: 8,
        alertCheckIds: [agentId],
      },
    })
  }
  async function saveLine(event: FormEvent) {
    event.preventDefault()
    await act({
      command: 'TEL-SAVE',
      idempotencyKey: crypto.randomUUID(),
      payload: {
        existingProviderNumberId: numberId,
        purpose: 'email_response',
        routingPolicy: 'primary_then_backup',
        hours: { ...weekdayHours },
        voicemail: 'enabled',
        callerIdPolicy: 'no_outbound_calls',
      },
    })
  }
  return (
    <section className={styles.operations} aria-label="Sending and phone">
      <h3>Sending, calendar and phone</h3>
      <p>
        Google Calendar bookings, push delivery and a live response number stay
        off until each connection is verified. CRM tasks already work.
      </p>
      {(focus === 'all' || focus === 'calendar') && (
      <form className={styles.form} onSubmit={saveCalendar}>
        <h4>Callback calendar policy</h4>
        <p>
          15-minute callbacks, 10-minute buffer, weekdays after 8:30 AM
          Chicago time. Automatic booking stays off. Stored CRM Google tokens
          are not treated as a working Email connection.
        </p>
        <label>
          Agent calendar owner
          <select
            required
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Choose a team member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <p>
          Saved policy:{' '}
          {data.scheduling
            ? `Manual · ${data.scheduling.duration_minutes} minutes · max ${data.scheduling.max_daily_bookings}/day`
            : 'Not saved'}
        </p>
        <button disabled={busy || !agentId}>Save manual calendar policy</button>
      </form>
      )}
      {(focus === 'all' || focus === 'phone') && (
      <form className={styles.form} onSubmit={saveLine}>
        <h4>Email-response number</h4>
        <p>
          Paste the ID of an existing owned number. This does not buy or
          provision a line, and it will not use Ads or personal agent numbers.
        </p>
        <label>
          Existing number ID
          <input
            required
            value={numberId}
            onChange={(e) => setNumberId(e.target.value)}
            placeholder="UUID from the phone system"
            pattern="[0-9a-fA-F-]{36}"
          />
        </label>
        <p>
          {data.responseLine
            ? `Intended only · ${data.responseLine.routing_policy.replaceAll('_', ' ')}`
            : 'No intended line saved'}
        </p>
        <button disabled={busy || numberId.length < 36}>
          Save intended response line
        </button>
      </form>
      )}
      {(focus === 'all' || focus === 'phone') && (
      <div className={styles.form}>
        <h4>Push alerts</h4>
        <p>
          In-app alerts already stay on the assigned person. A lockscreen push
          test records a blocked attempt until device registration is verified.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            act({
              command: 'NTF-TEST',
              idempotencyKey: crypto.randomUUID(),
              payload: {
                channel: 'push',
                subscriptionRef: crypto.randomUUID(),
              },
            })
          }
        >
          Record a push test
        </button>
      </div>
      )}
    </section>
  )
}
