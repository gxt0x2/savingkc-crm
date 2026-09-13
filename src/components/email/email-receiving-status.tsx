'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import styles from './email-workspace.module.css'
type Job = {
  can_retry?: boolean
  id: string
  kind: string
  state: string
  attempts: number
  run_after: string
  lease_until: string | null
  last_error: string | null
  hold_reason: string | null
}
const reason: Record<string, string> = {
  REPLY_IDENTITY_REVIEW: 'Sender or conversation match needs review.',
  REPLY_CONTENT_REVIEW_REQUIRED: 'Message content needs manual review.',
  REPLY_CONNECTION_REJECTED: 'Resend access needs attention.',
  REPLY_CONNECTION_REVIEW: 'Resend connection changed. Review setup.',
  REPLY_NOT_READY: 'Resend has not made the full message available yet.',
  REPLY_RATE_LIMIT: 'Waiting for Resend’s rate limit to clear.',
  REPLY_PROVIDER_UNAVAILABLE: 'Resend could not be reached.',
  unmatched_reply: 'No unique conversation match. Automatic sending is paused.',
  event_reducer_pending: 'This event type needs review.',
  unsupported_payload: 'The provider payload needs review.',
}
export function EmailReceivingStatus({
  localSimulation,
  onProcessed,
  act,
}: {
  act: (command: EmailCommand) => Promise<unknown>
  localSimulation: boolean
  onProcessed: () => Promise<unknown>
}) {
  const [data, setData] = useState<{ jobs: Job[]; total: number } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const request = useRef(0),
    alive = useRef(true)
  const refresh = useCallback(async () => {
    const id = ++request.current
    try {
      const response = await fetch('/api/email/receiving', {
        cache: 'no-store',
      })
      if (!response.ok) throw Error()
      const value = await response.json()
      if (alive.current && id === request.current) {
        setData(value)
        setError('')
      }
    } catch {
      if (alive.current && id === request.current)
        setError('Receiving status could not be loaded. Try refreshing.')
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])
  async function retry(job: Job) {
    setBusy(true)
    try {
      await act({
        command: 'OPS-REPLAY',
        idempotencyKey: crypto.randomUUID(),
        payload: {
          jobId: job.id,
          expectedFailureCode: job.last_error!,
          reason:
            'Owner reviewed the retrieval failure and requested another attempt.',
        },
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  async function process() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/email/receiving', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process_next' }),
      })
      if (!response.ok) throw Error()
      await refresh()
      await onProcessed()
    } catch {
      setError(
        'The receiving check could not finish. Saved replies remain on hold. Check the connection and retry.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Receiving replies" className={styles.agenda}>
      <div className={styles.row}>
        <h4>Receiving replies{data ? ` (${data.total})` : ''}</h4>
        <button disabled={busy} onClick={() => void refresh()}>
          Refresh receiving status
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>Loading receiving status…</p>
      ) : !data.jobs.length ? (
        <p>No replies are waiting for retrieval or review.</p>
      ) : (
        <div className={styles.agendaItems}>
          {data.jobs.map((job) => (
            <article key={job.id} className={styles.agendaItem}>
              <strong>
                {job.state === 'dead'
                  ? 'Needs review'
                  : job.state === 'leased'
                    ? 'Retrieving reply'
                    : job.state === 'retry'
                      ? 'Retry scheduled'
                      : 'Ready to retrieve'}
              </strong>
              <span>
                {reason[job.last_error ?? job.hold_reason ?? ''] ??
                  'The full reply is pending. Follow-ups remain held.'}
              </span>
              <small>{job.attempts} retrieval attempts</small>
              {job.can_retry && !localSimulation && (
                <button disabled={busy} onClick={() => void retry(job)}>
                  Retry retrieval
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {localSimulation ? (
        <small>Practice workspace. Live receiving is not connected.</small>
      ) : (
        <button
          disabled={
            busy ||
            !data?.jobs.some(
              (j) =>
                j.kind === 'resend_receive_content' &&
                ['ready', 'retry', 'leased'].includes(j.state),
            )
          }
          onClick={() => void process()}
        >
          {busy ? 'Checking…' : 'Retrieve next reply'}
        </button>
      )}
      {!!data && data.total > data.jobs.length && (
        <small>
          Showing the earliest {data.jobs.length} of {data.total} pending items.
        </small>
      )}
    </section>
  )
}
