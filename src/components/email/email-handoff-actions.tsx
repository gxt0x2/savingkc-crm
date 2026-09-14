'use client'

import { useState } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import type { PilotState, PilotThread } from '@/lib/email/workflow/types'
import styles from './email-workspace.module.css'
import { defaultEmailBackup } from '@/lib/email/backup-pairing'

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
  const [newOwner, setNewOwner] = useState(t.handoff_owner_id ?? '')
  const [backup, setBackup] = useState(t.handoff_backup_id ?? '')
  const [reason, setReason] = useState('')
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
  const allowed =
    data.roles.some((r) => ['owner', 'reviewer'].includes(r)) ||
    (data.roles.includes('acquisitions') && t.handoff_owner_id === data.actorId)
  const available =
    allowed &&
    t.handoff_id &&
    !['stopped', 'done'].includes(t.state) &&
    (resolve ||
      (t.crm_sync_state === 'synced' && t.callback_task_state === 'pending'))
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
          }
          setOpen(!open)
        }}
      >
        {resolve
          ? 'Review held request'
          : t.callback_owner_changed
            ? 'Resolve assignment'
            : 'Change assignment'}
      </button>
      {open && (
        <form
          className={styles.drawerForm}
          onSubmit={async (e) => {
            e.preventDefault()
            if (!reviewed || changed) return
            const common = {
              handoffId: t.handoff_id!,
              backupId: backup,
              reason,
              contentRevision: reviewed.content,
              controllerRevision: reviewed.controller,
            }
            const result =
              resolve && inbound
                ? await act({
                    command: 'HAN-RESOLVE',
                    idempotencyKey: crypto.randomUUID(),
                    expectedRevision: reviewed.handoff,
                    payload: {
                      ...common,
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
                      ...common,
                      newOwnerId: newOwner,
                      expectedCrmOwner: reviewed.crmOwner,
                    },
                  })
            if (result) {
              setOpen(false)
              setReason('')
            }
          }}
        >
          <p>
            {resolve
              ? 'Review the latest seller reply, then retry linking this saved request.'
              : `CRM owner: ${t.crm_owner_name ?? 'Unassigned'}. This changes the Lead and this Email callback together. Other tasks keep their assignments.`}
          </p>
          {changed && (
            <p role="alert">
              The conversation or assignment changed. Close and reopen this form
              to review it again.
            </p>
          )}
          <label>
            Callback owner
            <select
              aria-label="Callback owner"
              value={newOwner}
              onChange={(e) => {
                const owner = e.target.value
                setNewOwner(owner)
                setBackup(defaultEmailBackup(owner, data.routing, data.members) ?? '')
              }}
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
          <button
            className={styles.primary}
            disabled={
              busy ||
              !!changed ||
              !reason.trim() ||
              !newOwner ||
              !backup ||
              newOwner === backup ||
              (resolve && !inbound)
            }
          >
            {resolve ? 'Save review & retry' : 'Assign Lead & callback'}
          </button>
        </form>
      )}
    </section>
  )
}
