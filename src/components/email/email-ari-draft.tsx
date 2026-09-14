'use client'

import type { EmailCommand } from '@/lib/email/contracts'
import type { PilotState, PilotThread } from '@/lib/email/workflow/types'
import styles from './email-workspace.module.css'

export function EmailAriDraft({
  data,
  thread: t,
  busy,
  act,
  approve,
  edit,
}: {
  data: PilotState
  thread: PilotThread
  busy: boolean
  act: (command: EmailCommand) => Promise<unknown>
  approve: (body: string) => void
  edit: (body: string) => void
}) {
  if (!data.ai_available) return null
  const g = t.ai_generation
  const current =
    g?.content_revision === t.content_revision &&
    g?.controller_revision === t.controller_revision
  const expired =
    g &&
    new Date(data.asOf).getTime() - new Date(g.created_at).getTime() > 120000
  const pending = g && ['queued', 'running'].includes(g.state) && !expired
  const output = g?.state === 'ready' && current ? g.output : null
  return (
    <section className={styles.suggestion} aria-label="Ari reply draft">
      <div className={styles.row}>
        <strong>Ari</strong>
        <small>Human approval required</small>
      </div>
      {pending ? (
        <p>Ari is preparing a reply. It will appear here when ready.</p>
      ) : output ? (
        <>
          <p>{output.decision === 'reply' ? output.body : output.reason}</p>
          {output.decision === 'reply' && (
            <div className={styles.actions}>
              <button
                className={styles.primary}
                disabled={busy || t.reply_queued}
                onClick={() => approve(output.body)}
              >
                Approve & queue reply
              </button>
              <button disabled={busy} onClick={() => edit(output.body)}>
                Edit reply
              </button>
            </div>
          )}
          <details>
            <summary>Why this reply</summary>
            <p>{output.summary}</p>
            {output.evidence.map((e, i) => (
              <blockquote key={i}>{e.quote}</blockquote>
            ))}
          </details>
        </>
      ) : g ? (
        <p>
          {g.failure_code === 'AI_CREDITS_REQUIRED'
            ? 'Ari needs paid AI credits. An owner can add credits in Vercel, then try again. You can still write a reply here.'
            : g.failure_code === 'AI_CONNECTION_EXPIRED'
              ? 'The AI connection has expired. An owner needs to reconnect it. You can still write a reply here.'
              : g.state === 'failed' || expired
                ? 'Ari could not finish this draft. You can write a reply or try again.'
                : 'The conversation changed. Prepare a fresh draft before approving.'}
        </p>
      ) : (
        <p>Prepare a reply using this conversation.</p>
      )}
      {!output && (
        <button
          disabled={busy || !!pending}
          onClick={() =>
            act({
              command: 'THR-REGENERATE',
              idempotencyKey: crypto.randomUUID(),
              payload: {
                threadId: t.id,
                contentRevision: t.content_revision,
                controllerRevision: t.controller_revision,
              },
            })
          }
        >
          Prepare with Ari
        </button>
      )}
    </section>
  )
}
