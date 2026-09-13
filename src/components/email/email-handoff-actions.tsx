'use client'

import { useState } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import type { PilotState, PilotThread } from '@/lib/email/workflow/types'
import styles from './email-workspace.module.css'

export function EmailHandoffActions({
  data,
  thread: t,
  act,
  busy,
}: {
  data: PilotState
  thread: PilotThread
  act: (command: EmailCommand) => Promise<unknown>
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'assign' | 'return'>('assign')
  const [newOwner, setNewOwner] = useState(t.handoff_owner_id ?? '')
  const [backup, setBackup] = useState(t.handoff_backup_id ?? '')
  const [reviewer, setReviewer] = useState(data.reviewers[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const [question, setQuestion] = useState('')
  const [interest, setInterest] = useState(false)
  const [phone, setPhone] = useState(t.requested_contact?.phone ?? '')
  const [timing, setTiming] = useState(
    t.requested_contact?.requestedTimeText ?? '',
  )
  const [reviewed, setReviewed] = useState<{
    content: number
    controller: number
    handoff: number
    crmOwner: string | null
  } | null>(null)
  const inbound = data.messages
    .filter((m) => m.thread_id === t.id && m.direction === 'inbound')
    .at(-1)
  const resolve = t.handoff_state === 'held' && !t.lead_id && !t.crm_task_id
  const release =
    t.handoff_state === 'held' &&
    t.crm_sync_state === 'synced' &&
    Boolean(t.access_hold_reason)
  const related = t.open_related_handoffs ?? []
  const allowed =
    data.roles.some((r) => ['owner', 'reviewer'].includes(r)) ||
    (data.roles.includes('acquisitions') && t.handoff_owner_id === data.actorId)
  const available =
    allowed &&
    t.handoff_id &&
    t.state !== 'done' &&
    (resolve ||
      release ||
      (t.crm_sync_state === 'synced' &&
        (t.callback_task_state === 'pending' ||
          t.callback_task_state === 'blocked')))
  if (!available) return null
  const changed =
    reviewed &&
    (reviewed.content !== t.content_revision ||
      reviewed.controller !== t.controller_revision ||
      reviewed.handoff !== t.handoff_revision ||
      reviewed.crmOwner !== (t.crm_owner_name ?? null))
  return (
    <section
      className={styles.handoffActions}
      aria-label="Callback assignment and review"
    >
      <button
        type="button"
        disabled={busy}
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setReviewed({
              content: t.content_revision,
              controller: t.controller_revision,
              handoff: t.handoff_revision ?? 0,
              crmOwner: t.crm_owner_name ?? null,
            })
            setInterest(false)
            setMode('assign')
          }
          setOpen(!open)
        }}
      >
        {resolve
          ? 'Review held request'
          : release
            ? 'Release held callback'
            : t.callback_owner_changed
              ? 'Resolve assignment'
              : 'Change assignment'}
      </button>
      {open && (
        <form
          className={styles.drawerForm}
          onSubmit={async (e) => {
            e.preventDefault()
            if (!reviewed || changed || !t.handoff_id) return
            const result =
              mode === 'return'
                ? await act({
                    command: 'HAN-RETURN',
                    idempotencyKey: crypto.randomUUID(),
                    expectedRevision: reviewed.handoff,
                    payload: {
                      handoffId: t.handoff_id,
                      question,
                      reviewerId: reviewer,
                    },
                  })
                : resolve && inbound
                  ? await act({
                      command: 'HAN-RESOLVE',
                      idempotencyKey: crypto.randomUUID(),
                      expectedRevision: reviewed.handoff,
                      payload: {
                        handoffId: t.handoff_id,
                        backupId: backup,
                        reason,
                        contentRevision: reviewed.content,
                        controllerRevision: reviewed.controller,
                        ownerId: newOwner,
                        positiveSellerInterest: interest,
                        requestedContact: {
                          ...(phone.trim() ? { phone: phone.trim() } : {}),
                          ...(timing.trim()
                            ? { requestedTimeText: timing.trim() }
                            : {}),
                        },
                        factEvidence: [
                          {
                            source: 'message',
                            messageId: inbound.id,
                            quote: inbound.text_body,
                          },
                        ],
                      },
                    })
                  : await act({
                      command: 'HAN-REASSIGN',
                      idempotencyKey: crypto.randomUUID(),
                      expectedRevision: reviewed.handoff,
                      payload: {
                        handoffId: t.handoff_id,
                        backupId: backup,
                        reason,
                        contentRevision: reviewed.content,
                        controllerRevision: reviewed.controller,
                        newOwnerId: newOwner,
                        expectedCrmOwner: reviewed.crmOwner,
                        ...(related.length
                          ? {
                              relatedHandoffs: related.map((item) => ({
                                handoffId: item.id,
                                expectedRevision: item.revision,
                              })),
                            }
                          : {}),
                      },
                    })
            if (result) {
              setOpen(false)
              setReason('')
              setQuestion('')
            }
          }}
        >
          {!resolve && (
            <label>
              Action
              <select
                aria-label="Handoff action"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="assign">
                  {release
                    ? 'Release hold and assign'
                    : 'Assign Lead and callbacks'}
                </option>
                <option value="return">Return for clarification</option>
              </select>
            </label>
          )}
          <p>
            {mode === 'return'
              ? 'Holds this callback for a reviewer. Marketing stays stopped and old sequence sends are not resumed.'
              : resolve
                ? 'Review the latest seller reply, then retry linking this saved request.'
                : release
                  ? `Release the ${t.access_hold_reason?.replaceAll('_', ' ')} hold and assign an eligible owner. Sending stays off.`
                  : `CRM owner: ${t.crm_owner_name ?? 'Unassigned'}. This changes the Lead and every listed open Email callback together.`}
          </p>
          {related.length > 0 && mode === 'assign' && (
            <p>
              {related.length} other open Email callback
              {related.length === 1 ? '' : 's'} will move with this Lead.
            </p>
          )}
          {t.clarification_question && (
            <p>Open question: {t.clarification_question}</p>
          )}
          {changed && (
            <p role="alert">
              The conversation or assignment changed. Close and reopen this form
              to review it again.
            </p>
          )}
          {mode === 'return' ? (
            <>
              <label>
                Reviewer
                <select
                  aria-label="Clarification reviewer"
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  required
                >
                  <option value="">Choose a reviewer</option>
                  {(data.reviewers ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Question
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  required
                  maxLength={2000}
                  rows={2}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Callback owner
                <select
                  aria-label="Callback owner"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  required
                >
                  <option value="">Choose an agent</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Backup
                <select
                  aria-label="Callback backup"
                  value={backup}
                  onChange={(e) => setBackup(e.target.value)}
                  required
                >
                  <option value="">Choose a backup</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              {resolve && (
                <>
                  <blockquote>
                    {inbound?.text_body ?? 'No seller reply available.'}
                  </blockquote>
                  <label className={styles.checkboxLine}>
                    <input
                      type="checkbox"
                      checked={interest}
                      onChange={(e) => setInterest(e.target.checked)}
                    />
                    I confirmed seller interest in this reply.
                  </label>
                  <label>
                    Phone from reply
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Requested time from reply
                    <input
                      value={timing}
                      onChange={(e) => setTiming(e.target.value)}
                      maxLength={2000}
                    />
                  </label>
                </>
              )}
              <label>
                Reason
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  maxLength={2000}
                  rows={2}
                />
              </label>
            </>
          )}
          <button
            className={styles.primary}
            disabled={
              busy ||
              !!changed ||
              (mode === 'return'
                ? !question.trim() || !reviewer
                : !reason.trim() ||
                  !newOwner ||
                  !backup ||
                  newOwner === backup ||
                  (resolve && !inbound))
            }
          >
            {mode === 'return'
              ? 'Return for clarification'
              : resolve
                ? 'Save review & retry'
                : release
                  ? 'Release & assign'
                  : related.length
                    ? 'Assign Lead & open callbacks'
                    : 'Assign Lead & callback'}
          </button>
        </form>
      )}
    </section>
  )
}
