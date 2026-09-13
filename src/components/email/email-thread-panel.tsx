'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import type { PilotState, PilotThread } from '@/lib/email/workflow/types'
import {
  formatEmailTime as time,
  hasCrmIssue,
  nextWork,
  practiceReply,
} from '@/lib/email/workflow/presentation'
import { chicagoDateTime } from '@/lib/email/workflow/schedule'
import styles from './email-workspace.module.css'
import { EmailCalendarAgenda } from './email-calendar-agenda'
import { EmailHandoffActions } from './email-handoff-actions'
import { EmailAriDraft } from './email-ari-draft'

const detailTabs = [
  ['next', 'Next step'],
  ['contact', 'Contact'],
  ['property', 'Property'],
  ['followups', 'Calendar'],
  ['notes', 'Notes'],
  ['ari', 'Ari’s Insights'],
] as const
type DetailTab = (typeof detailTabs)[number][0]

function DetailIcon({ tab }: { tab: DetailTab }) {
  const paths: Record<DetailTab, string> = {
    next: 'M4 12h16 M13 5l7 7-7 7',
    contact:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M17 11h6',
    property: 'M3 10 12 3l9 7 M5 9v12h14V9 M9 21v-8h6v8',
    followups: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h3 M8 17h6',
    notes: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
    ari: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  }
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[tab]} />
    </svg>
  )
}

type Act = (
  command: EmailCommand,
) => Promise<{ entityId: string; state: string } | null>

function MessageBody({ body }: { body: string }) {
  const index = body.search(/\n(?:On .+wrote:|From:|>)/i)
  return (
    <>
      <p>{index < 0 ? body : body.slice(0, index)}</p>
      {index >= 0 && (
        <details>
          <summary>Quoted history</summary>
          <p>{body.slice(index)}</p>
        </details>
      )}
    </>
  )
}

export function EmailThreadPanel({
  data,
  thread: t,
  act,
  busy,
  localSimulation,
}: {
  data: PilotState
  thread: PilotThread
  act: Act
  busy: boolean
  localSimulation: boolean
}) {
  const messages = data.messages.filter((m) => m.thread_id === t.id)
  const inbound = messages.filter((m) => m.direction === 'inbound').at(-1)
  const last = messages.at(-1)
  const draft = data.drafts.findLast(
    (d) => d.thread_id === t.id && d.state === 'current',
  )
  const [editor, setEditor] = useState({
    body: draft?.body ?? '',
    revision: t.content_revision,
    controller: t.controller_revision,
  })
  const [details, setDetails] = useState(true)
  const [detailTab, setDetailTab] = useState<DetailTab>('next')
  const [composing, setComposing] = useState(false)
  const [older, setOlder] = useState(false)
  const [note, setNote] = useState('')
  const [schedule, setSchedule] = useState('')
  const [schedulerOpen, setSchedulerOpen] = useState(false)
  const [taskTitle, setTaskTitle] = useState(t.callback_title ?? 'Call seller')
  const [scheduleMode, setScheduleMode] = useState<'new' | 'callback'>('new')
  const [taskKind, setTaskKind] = useState<
    'follow_up' | 'callback' | 'appointment' | 'task' | 'send_offer'
  >('follow_up')
  const [taskAssignee, setTaskAssignee] = useState(
    t.handoff_owner_id ?? data.actorId,
  )
  const [taskNote, setTaskNote] = useState(t.callback_notes ?? '')
  const [outcome, setOutcome] = useState('')
  const [outcomeKind, setOutcomeKind] = useState<
    'conversation_complete' | 'follow_up' | 'no_contact' | 'not_qualified'
  >('conversation_complete')
  const [nextAction, setNextAction] = useState('')
  const [outcomeDue, setOutcomeDue] = useState('')
  const [qualifyOpen, setQualifyOpen] = useState(false)
  const [qualifyWhy, setQualifyWhy] = useState('')
  const [qualifyNext, setQualifyNext] = useState('')
  const [qualifyPillars, setQualifyPillars] = useState({
    timeline: '',
    condition: '',
    motivation: '',
    price: '',
  })
  const outcomeRemainsOpen =
    outcomeKind === 'follow_up' || outcomeKind === 'no_contact'
  const qualifyReady =
    Boolean(inbound) &&
    Object.values(qualifyPillars).every((value) => value.trim()) &&
    qualifyWhy.trim() &&
    qualifyNext.trim() &&
    Boolean(t.property?.address) &&
    t.lead_id &&
    Number.isFinite(Number(t.lead_revision))
  const [localError, setLocalError] = useState('')
  const [working, setWorking] = useState(false)
  const scheduleRequest = useRef<{ fingerprint: string; key: string } | null>(
    null,
  )
  const [scheduleRevision, setScheduleRevision] = useState({
    thread: t.content_revision,
    controller: t.controller_revision,
    handoff: t.handoff_revision ?? 0,
  })
  const history = useRef<HTMLDivElement>(null)
  const drawerClose = useRef<HTMLButtonElement>(null)
  const drawerTrigger = useRef<HTMLButtonElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const operation = useRef(false)
  const owns =
    t.controller_user_id === data.actorId &&
    t.state !== 'stopped' &&
    t.state !== 'done'
  const canWork = data.roles.some((r) =>
    ['owner', 'reviewer', 'acquisitions'].includes(r),
  )
  const blocked = busy || working || Boolean(t.inbound_pending)
  const stale =
    editor.revision !== t.content_revision ||
    editor.controller !== t.controller_revision
  const proposal =
    localSimulation &&
    inbound &&
    last?.direction === 'inbound' &&
    !hasCrmIssue(t) &&
    t.state !== 'stopped' &&
    t.state !== 'done'
      ? practiceReply(inbound.text_body)
      : null
  const owner = data.members.find(
    (m) => m.id === (t.handoff_owner_id ?? t.responsible_user_id),
  )
  const title = nextWork(t, data.asOf)
  const taskEditable =
    owns &&
    t.handoff_owner_id === data.actorId &&
    t.crm_sync_state === 'synced' &&
    t.callback_task_state === 'pending' &&
    !hasCrmIssue(t)
  const selectDetailTab = (tab: DetailTab) => {
    setDetailTab(tab)
    if (tab === 'followups' && !schedule && !outcome) {
      setScheduleRevision({
        thread: t.content_revision,
        controller: t.controller_revision,
        handoff: t.handoff_revision ?? 0,
      })
    }
  }
  const openDetails = (tab: DetailTab = detailTab) => {
    setDetailTab(tab)
    setDetails(true)
    if (tab === 'followups') {
      setSchedulerOpen(true)
      setScheduleMode(taskEditable ? 'callback' : 'new')
    }
    setScheduleRevision({
      thread: t.content_revision,
      controller: t.controller_revision,
      handoff: t.handoff_revision ?? 0,
    })
  }
  const closeDetails = () => {
    setDetails(false)
    drawerTrigger.current?.focus()
  }
  useEffect(() => {
    if (history.current)
      history.current.scrollTop = history.current.scrollHeight
  }, [last?.id])
  useEffect(() => {
    if (!details) return
    drawerClose.current?.focus()
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDetails(false)
        drawerTrigger.current?.focus()
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [details])
  async function queueReply(
    body: string,
    revision = t.content_revision,
    controller = t.controller_revision,
  ) {
    if (operation.current) return
    operation.current = true
    setWorking(true)
    try {
      const saved =
        draft?.body === body &&
        draft.content_revision === revision &&
        draft.controller_revision === controller
          ? { entityId: draft.id }
          : await act({
              command: 'THR-DRAFT',
              idempotencyKey: crypto.randomUUID(),
              payload: {
                threadId: t.id,
                body,
                contentRevision: revision,
                controllerRevision: controller,
              },
            })
      if (!saved) return
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(JSON.stringify(body)),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const queued = await act({
        command: 'THR-SEND',
        idempotencyKey: crypto.randomUUID(),
        payload: {
          draftId: saved.entityId,
          bodyHash: hash,
          contentRevision: revision,
          controllerRevision: controller,
        },
      })
      if (queued) {
        setEditor({ body: '', revision, controller })
        setComposing(false)
      }
    } finally {
      operation.current = false
      setWorking(false)
    }
  }
  async function handoff() {
    if (!inbound || !proposal?.phone || !proposal.interest) return
    const assigned = data.routing?.acquisitionOwnerId ?? data.actorId
    const backup =
      data.routing?.backupId ?? data.members.find((m) => m.id !== assigned)?.id
    if (!backup) {
      setLocalError('Choose an acquisitions owner and backup in setup first.')
      return
    }
    await act({
      command: 'THR-HANDOFF',
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: t.content_revision,
      payload: {
        threadId: t.id,
        ownerId: assigned,
        backupId: backup,
        reason:
          'Agent approved contact information and selling context in the current reply.',
        positiveSellerInterest: proposal.interest,
        requestedContact: {
          phone: proposal.phone,
          ...(proposal.time ? { requestedTimeText: proposal.time } : {}),
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
  }
  const repair = t.crm_repair_id && t.crm_repair_error_code
  return (
    <div
      className={`${styles.threadWorkspace} ${details ? styles.withDetails : ''}`}
    >
      <section
        className={styles.conversation}
        aria-label="Selected conversation"
      >
        <header className={styles.conversationHeader}>
          <div>
            <h3>{t.name}</h3>
            <p>
              {t.email} · {t.subject}
            </p>
          </div>
          <div className={styles.headerRight}>
            {t.state === 'stopped' && (
              <span className={styles.badge}>
                {t.outcome === 'unsubscribed'
                  ? 'Unsubscribed'
                  : 'Marketing stopped'}
              </span>
            )}
            <button
              ref={drawerTrigger}
              aria-expanded={details}
              aria-controls="email-contact-details"
              onClick={() => (details ? closeDetails() : openDetails())}
            >
              Details
            </button>
          </div>
        </header>
        <div
          className={styles.messages}
          aria-label="Email history"
          tabIndex={0}
          ref={history}
        >
          {messages.length > 3 && (
            <button
              className={styles.historyToggle}
              onClick={() => setOlder(!older)}
            >
              {older
                ? 'Collapse earlier messages'
                : `Show ${messages.length - 3} earlier messages`}
            </button>
          )}
          {(older ? messages : messages.slice(-3)).map((m) => (
            <article
              key={m.id}
              className={
                m.direction === 'inbound' ? styles.incoming : styles.outgoing
              }
            >
              <div className={styles.row}>
                <strong>
                  {m.direction === 'inbound'
                    ? `${t.name} → SavingKC`
                    : `SavingKC → ${t.name}`}
                </strong>
                <small>{time(m.occurred_at)}</small>
              </div>
              <small>
                {m.direction === 'inbound'
                  ? m.transport === 'resend'
                    ? 'Received via Resend'
                    : 'Received'
                  : localSimulation
                    ? 'Sent · simulated'
                    : 'Sent'}
              </small>
              <MessageBody body={m.text_body} />
              {!!m.attachment_metadata?.length && (
                <details>
                  <summary>
                    {m.attachment_metadata.length} attachments · not opened
                  </summary>
                  {m.attachment_metadata.map((a) => (
                    <p key={a.id}>
                      {a.filename} · {a.content_type}
                    </p>
                  ))}
                  <small>Attachment downloads are not enabled.</small>
                </details>
              )}
            </article>
          ))}
          {!messages.length && (
            <p>The first email is scheduled. No message has been sent.</p>
          )}
        </div>
        {localError && (
          <p role="alert" className={styles.error}>
            {localError}
          </p>
        )}
        <footer className={styles.composer} aria-label="Reply composer">
          {owns &&
          proposal?.body &&
          !editor.body &&
          !composing &&
          !t.reply_queued ? (
            <button
              onClick={() => {
                setComposing(true)
                requestAnimationFrame(() => composer.current?.focus())
              }}
            >
              Write a reply
            </button>
          ) : owns ? (
            <>
              {stale && editor.body && (
                <div role="alert" className={styles.error}>
                  The conversation changed. Read the latest message before using
                  this draft.
                  <button
                    onClick={() =>
                      setEditor({
                        ...editor,
                        revision: t.content_revision,
                        controller: t.controller_revision,
                      })
                    }
                  >
                    I reviewed the latest reply
                  </button>
                </div>
              )}
              <label>
                Reply draft
                <textarea
                  aria-label="Reply draft"
                  ref={composer}
                  rows={2}
                  value={editor.body}
                  disabled={blocked || Boolean(t.reply_queued)}
                  onChange={(e) =>
                    setEditor(
                      editor.body
                        ? { ...editor, body: e.target.value }
                        : {
                            body: e.target.value,
                            revision: t.content_revision,
                            controller: t.controller_revision,
                          },
                    )
                  }
                  placeholder="Write a reply or edit the prepared suggestion."
                />
              </label>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={
                    blocked ||
                    stale ||
                    !editor.body.trim() ||
                    Boolean(t.reply_queued)
                  }
                  onClick={() =>
                    queueReply(editor.body, editor.revision, editor.controller)
                  }
                >
                  Queue simulated reply
                </button>
                <button
                  disabled={
                    blocked ||
                    stale ||
                    !editor.body.trim() ||
                    Boolean(t.reply_queued)
                  }
                  onClick={() =>
                    act({
                      command: 'THR-DRAFT',
                      idempotencyKey: crypto.randomUUID(),
                      payload: {
                        threadId: t.id,
                        body: editor.body,
                        contentRevision: editor.revision,
                        controllerRevision: editor.controller,
                      },
                    })
                  }
                >
                  Save reply draft
                </button>
                {!t.handoff_id && (
                  <button
                    disabled={blocked}
                    onClick={() =>
                      act({
                        command: 'THR-CLOSE',
                        idempotencyKey: crypto.randomUUID(),
                        expectedRevision: t.content_revision,
                        payload: {
                          threadId: t.id,
                          closed: true,
                          reason: 'Agent marked conversation done.',
                        },
                      })
                    }
                  >
                    Mark done
                  </button>
                )}
              </div>
            </>
          ) : (
            <small>
              {t.state === 'stopped'
                ? 'Sending is stopped.'
                : t.state === 'done'
                  ? 'Conversation finished.'
                  : `Take over to reply${owner?.name ? ` · Assigned to ${owner.name}` : ''}.`}
            </small>
          )}
        </footer>
      </section>
      {details && (
        <aside
          id="email-contact-details"
          className={styles.contextDrawer}
          aria-label="Contact and property"
        >
          <div className={styles.drawerTop}>
            <header className={styles.drawerCloseRow}>
              <button
                ref={drawerClose}
                onClick={closeDetails}
                aria-label="Close details"
              >
                ×
              </button>
            </header>
            <div
              role="tablist"
              aria-label="Contact details sections"
              className={styles.detailTabs}
            >
              {detailTabs.map(([id, label], index) => (
                <button
                  key={id}
                  role="tab"
                  id={`details-tab-${id}`}
                  aria-controls={`details-panel-${id}`}
                  aria-selected={detailTab === id}
                  tabIndex={detailTab === id ? 0 : -1}
                  onClick={() => selectDetailTab(id)}
                  onKeyDown={(event) => {
                    let next = index
                    if (event.key === 'ArrowRight')
                      next = (index + 1) % detailTabs.length
                    else if (event.key === 'ArrowLeft')
                      next = (index - 1 + detailTabs.length) % detailTabs.length
                    else if (event.key === 'Home') next = 0
                    else if (event.key === 'End') next = detailTabs.length - 1
                    else return
                    event.preventDefault()
                    selectDetailTab(detailTabs[next][0])
                    document
                      .getElementById(`details-tab-${detailTabs[next][0]}`)
                      ?.focus()
                  }}
                >
                  <DetailIcon tab={id} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <section
            role="tabpanel"
            id="details-panel-next"
            aria-labelledby="details-tab-next"
            hidden={detailTab !== 'next'}
            tabIndex={0}
            className={styles.detailPanel}
          >
            <section
              className={`${styles.nextAction} ${hasCrmIssue(t) ? styles.crmAttention : ''}`}
              aria-label="Next action"
            >
              <div className={styles.row}>
                <strong>{title}</strong>
                <small>{owner?.name ?? 'Owner needs assignment'}</small>
              </div>
              {hasCrmIssue(t) ? (
                <>
                  <p>
                    {t.state === 'stopped' ? 'Marketing is stopped. ' : ''}
                    {t.callback_owner_changed
                      ? 'CRM and callback ownership differ. Review the current assignment before acting.'
                      : t.crm_callback_repair_required
                        ? 'The callback hold has not reached CRM. Review this task before calling.'
                        : t.crm_history_repair_required
                          ? 'Some conversation history has not reached CRM.'
                          : t.handoff_state === 'held' ||
                              t.callback_task_state === 'blocked'
                            ? 'Callback held for review. Resolve the hold before calling.'
                            : `Review ${t.crm_sync_reason?.replaceAll('_', ' ') ?? 'the CRM connection'} before continuing.`}
                  </p>
                  {repair && data.roles.includes('owner') && (
                    <button
                      disabled={blocked}
                      onClick={() =>
                        act({
                          command: 'OPS-REPLAY',
                          idempotencyKey: crypto.randomUUID(),
                          payload: {
                            jobId: t.crm_repair_id!,
                            expectedFailureCode: t.crm_repair_error_code!,
                            reason:
                              'Owner reviewed the pending CRM update and requested a retry.',
                          },
                        })
                      }
                    >
                      Retry CRM update
                    </button>
                  )}
                  <small>
                    Repairs update existing CRM records only; they send no
                    messages or calls.
                  </small>
                </>
              ) : t.inbound_pending ? (
                <p>
                  A reply arrived. Automated follow-ups are held while its full
                  content is retrieved. Review will resume when the message is
                  available.
                </p>
              ) : t.state === 'done' ? (
                <p>No remaining work. A new reply will return here.</p>
              ) : t.state === 'stopped' ? (
                <p>
                  Marketing is stopped. The message history remains available.
                </p>
              ) : (
                <>
                  {t.scheduled_for ? (
                    <p>
                      {time(t.scheduled_for)} · Manual follow-up task, no
                      calendar invitation.
                    </p>
                  ) : t.requested_contact?.requestedTimeText ? (
                    <p>
                      Seller asked for “{t.requested_contact.requestedTimeText}
                      ”. Confirm a specific time.
                    </p>
                  ) : proposal?.phone ? (
                    <p>
                      Phone provided: {proposal.phone}. Contact details are
                      ready for your approval.
                    </p>
                  ) : (
                    <p>
                      {t.reply_queued
                        ? 'Your reply is queued for simulated delivery.'
                        : t.state === 'waiting'
                          ? 'No human action is due.'
                          : 'Read the latest reply and choose the next step.'}
                    </p>
                  )}
                  {canWork && !owns && (
                    <button
                      className={styles.primary}
                      disabled={blocked}
                      onClick={() =>
                        act({
                          command: 'THR-TAKEOVER',
                          idempotencyKey: crypto.randomUUID(),
                          payload: {
                            threadId: t.id,
                            expectedControllerRevision: t.controller_revision,
                          },
                        })
                      }
                    >
                      Take over
                    </button>
                  )}
                  {owns && proposal?.phone && !t.handoff_id && (
                    <button
                      className={styles.primary}
                      disabled={blocked}
                      onClick={handoff}
                    >
                      Create Lead & callback
                    </button>
                  )}
                  {taskEditable && (
                    <button
                      disabled={blocked || t.handoff_state === 'acknowledged'}
                      onClick={() =>
                        act({
                          command: 'HAN-ACCEPT',
                          idempotencyKey: crypto.randomUUID(),
                          expectedRevision: t.handoff_revision ?? 0,
                          payload: { handoffId: t.handoff_id! },
                        })
                      }
                    >
                      {t.handoff_state === 'acknowledged'
                        ? 'Callback accepted'
                        : 'Accept callback'}
                    </button>
                  )}
                  {taskEditable && (
                    <button
                      disabled={blocked}
                      onClick={() => openDetails('followups')}
                    >
                      {t.scheduled_for
                        ? 'Update follow-up / record outcome'
                        : 'Set follow-up / record outcome'}
                    </button>
                  )}
                  {owns && inbound && !t.reply_queued && (
                    <EmailAriDraft
                      data={data}
                      thread={t}
                      busy={blocked}
                      act={act}
                      approve={(body) =>
                        queueReply(
                          body,
                          t.content_revision,
                          t.controller_revision,
                        )
                      }
                      edit={(body) => {
                        setEditor({
                          body,
                          revision: t.content_revision,
                          controller: t.controller_revision,
                        })
                        setComposing(true)
                        if (window.innerWidth <= 760) setDetails(false)
                        window.setTimeout(() => composer.current?.focus(), 0)
                      }}
                    />
                  )}
                  {owns &&
                    proposal?.body &&
                    !data.ai_available &&
                    !t.reply_queued && (
                      <div className={styles.suggestion}>
                        <small>
                          Practice suggestion · Live AI is not connected
                        </small>
                        <p>{proposal.body}</p>
                        <div className={styles.actions}>
                          <button
                            className={styles.primary}
                            disabled={blocked}
                            onClick={() => queueReply(proposal.body)}
                          >
                            Approve & queue reply
                          </button>
                          <button
                            disabled={blocked}
                            onClick={() => {
                              setEditor({
                                body: proposal.body,
                                revision: t.content_revision,
                                controller: t.controller_revision,
                              })
                              if (
                                window.matchMedia(
                                  '(max-width: 1150px), (max-height: 780px)',
                                ).matches
                              )
                                closeDetails()
                              requestAnimationFrame(() =>
                                composer.current?.focus(),
                              )
                            }}
                          >
                            Edit reply
                          </button>
                        </div>
                      </div>
                    )}
                </>
              )}
              <EmailHandoffActions
                key={t.handoff_id}
                data={data}
                thread={t}
                act={act}
                busy={blocked}
              />
            </section>
          </section>
          <section
            role="tabpanel"
            id="details-panel-contact"
            aria-labelledby="details-tab-contact"
            hidden={detailTab !== 'contact'}
            tabIndex={0}
            className={styles.detailPanel}
          >
            <p>{t.name}</p>
            <p>{t.email}</p>
            <p>
              {t.requested_contact?.phone ??
                proposal?.phone ??
                'No phone provided'}
            </p>
            <p>Assigned: {owner?.name ?? 'Unassigned'}</p>
            <p>
              Backup:{' '}
              {data.members.find((m) => m.id === t.handoff_backup_id)?.name ??
                'Not assigned'}
            </p>
            {t.lead_id && (
              <span className={styles.badge}>
                {t.lead_classification === 'opportunity'
                  ? 'Opportunity'
                  : 'Lead'}{' '}
                ·{' '}
                {t.lead_stage === 'contacted'
                  ? 'Contacted'
                  : t.lead_stage?.replaceAll('_', ' ')}
              </span>
            )}
            {t.lead_id && !localSimulation && (
              <Link className={styles.crmLink} href={`/leads/${t.lead_id}`}>
                Open CRM record
              </Link>
            )}
            <details>
              <summary>Source & controls</summary>
              <p>Campaign: {t.campaign_name}</p>
              <p>First-touch source: {t.lead_source ?? 'Email outreach'}</p>
              <p>CRM: {t.crm_sync_state ?? 'Not linked'}</p>
              {canWork && t.state !== 'stopped' && (
                <button
                  className={styles.danger}
                  disabled={blocked}
                  onClick={() =>
                    act({
                      command: 'SUP-ADD',
                      idempotencyKey: crypto.randomUUID(),
                      payload: {
                        addressIds: [t.address_id],
                        scope: 'all_marketing',
                        reason: 'manual',
                      },
                    })
                  }
                >
                  Stop marketing
                </button>
              )}
            </details>
          </section>
          <section
            role="tabpanel"
            id="details-panel-property"
            aria-labelledby="details-tab-property"
            hidden={detailTab !== 'property'}
            tabIndex={0}
            className={styles.detailPanel}
          >
            {t.property ? (
              <>
                <div className={styles.propertyCard}>
                  <div className={styles.propertyImage}>
                    <DetailIcon tab="property" />
                    <span>Property image unavailable</span>
                    <small>
                      {localSimulation
                        ? 'Fabricated practice property'
                        : 'Photo source not connected'}
                    </small>
                  </div>
                  <div className={styles.propertyAddress}>
                    <strong>{t.property.address}</strong>
                    <p>
                      {[t.property.city, t.property.state, t.property.zip]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                </div>
                <dl className={styles.propertyFacts}>
                  {[
                    ['Beds', t.property.bedrooms],
                    ['Baths', t.property.bathrooms],
                    ['Square feet', t.property.sqft?.toLocaleString('en-US')],
                    ['Year built', t.property.year_built],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value ?? 'Unknown'}</dd>
                    </div>
                  ))}
                </dl>
                <div className={styles.valuationCard}>
                  <small>Zestimate</small>
                  <strong>
                    {!localSimulation &&
                    typeof t.property.zestimate === 'number' &&
                    Number.isFinite(t.property.zestimate) &&
                    t.property.zestimate > 0
                      ? new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          maximumFractionDigits: 0,
                        }).format(t.property.zestimate)
                      : 'Not available'}
                  </strong>
                  <small>
                    {localSimulation
                      ? 'No Zillow valuation for this practice property.'
                      : 'Saved CRM value; freshness has not been verified.'}
                  </small>
                  <a
                    href="https://www.zillow.com/zestimate/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    About the Zestimate
                  </a>
                  {localSimulation ? (
                    <span className={styles.muted}>
                      Zillow property link unavailable for fabricated addresses.
                    </span>
                  ) : (
                    <a
                      target="_blank"
                      rel="noreferrer"
                      className={styles.crmLink}
                      href={`https://www.zillow.com/homes/${encodeURIComponent([t.property.address, t.property.city, t.property.state, t.property.zip].filter(Boolean).join(' ')).replace(/%20/g, '-')}_rb/`}
                    >
                      Find property on Zillow ↗
                    </a>
                  )}
                </div>
                {localSimulation ? (
                  <small>
                    Street View is unavailable for fabricated practice
                    properties.
                  </small>
                ) : (
                  <a
                    className={styles.crmLink}
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([t.property.address, t.property.city, t.property.state, t.property.zip].filter(Boolean).join(', '))}`}
                  >
                    Open map / choose Street View
                  </a>
                )}
              </>
            ) : (
              <p>Confirm the property match before showing property details.</p>
            )}
          </section>
          <section
            role="tabpanel"
            id="details-panel-followups"
            aria-labelledby="details-tab-followups"
            hidden={detailTab !== 'followups'}
            tabIndex={0}
            className={styles.detailPanel}
          >
            {t.inbound_pending && (
              <p role="status">
                A reply arrived. Scheduling and replies are held until its full
                content is available.
              </p>
            )}
            <div className={styles.calendarSummary}>
              <h4 className={styles.taskHeading}>Schedule follow-up</h4>
              <p>
                {t.scheduled_for
                  ? `Follow-up: ${time(t.scheduled_for)}`
                  : t.crm_task_id
                    ? `Review callback by ${time(t.callback_due_at)}`
                    : 'No callback task yet.'}
              </p>
              <p>
                Seller’s timing:{' '}
                {t.requested_contact?.requestedTimeText ?? 'Not specified'}
              </p>
              <small>Calendar not connected. No appointment booked.</small>
            </div>
            <>
              <button
                type="button"
                className={styles.schedulerToggle}
                aria-expanded={schedulerOpen}
                aria-controls="email-scheduler"
                onClick={() => setSchedulerOpen(!schedulerOpen)}
              >
                <span>Scheduler</span>
                <span aria-hidden="true">{schedulerOpen ? '−' : '+'}</span>
              </button>
              <div id="email-scheduler" hidden={!schedulerOpen}>
                <form
                  className={styles.drawerForm}
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (!canWork || !owns || !t.lead_id || hasCrmIssue(t))
                      return
                    setLocalError('')
                    let start: Date
                    try {
                      start = chicagoDateTime(schedule)
                    } catch {
                      setLocalError('Choose a valid Chicago date and time.')
                      return
                    }
                    const fingerprint = JSON.stringify([
                      t.id,
                      scheduleMode,
                      scheduleRevision,
                      taskTitle,
                      taskNote,
                      taskKind,
                      taskAssignee,
                      schedule,
                    ])
                    if (scheduleRequest.current?.fingerprint !== fingerprint)
                      scheduleRequest.current = {
                        fingerprint,
                        key: crypto.randomUUID(),
                      }
                    const result = await act(
                      scheduleMode === 'new'
                        ? {
                            command: 'THR-SCHEDULE',
                            idempotencyKey: scheduleRequest.current.key,
                            payload: {
                              threadId: t.id,
                              contentRevision: scheduleRevision.thread,
                              controllerRevision: scheduleRevision.controller,
                              title: taskTitle,
                              note: taskNote,
                              kind: taskKind,
                              assigneeId: taskAssignee,
                              startAt: start.toISOString(),
                              timezone: 'America/Chicago',
                            },
                          }
                        : {
                            command: 'HAN-SCHEDULE',
                            idempotencyKey: scheduleRequest.current.key,
                            expectedRevision: scheduleRevision.handoff,
                            payload: {
                              handoffId: t.handoff_id!,
                              mode: 'task',
                              title: taskTitle,
                              note: taskNote,
                              startAt: start.toISOString(),
                              timezone: 'America/Chicago',
                              contentRevision: scheduleRevision.thread,
                            },
                          },
                    )
                    if (result) {
                      scheduleRequest.current = null
                      setSchedule('')
                      setSchedulerOpen(false)
                      setScheduleRevision({
                        thread: t.content_revision,
                        controller: t.controller_revision,
                        handoff:
                          scheduleRevision.handoff +
                          (scheduleMode === 'callback' ? 1 : 0),
                      })
                    }
                  }}
                >
                  <p>
                    {!t.lead_id
                      ? 'Link this conversation to a Lead before saving scheduled work.'
                      : !owns
                        ? 'Take over this conversation to schedule work.'
                        : hasCrmIssue(t)
                          ? 'Resolve the CRM review before scheduling work.'
                          : 'Save work for this Lead. The assignee receives an in-app alert.'}
                  </p>
                  {(!t.lead_id || !owns || hasCrmIssue(t)) && (
                    <button
                      type="button"
                      onClick={() => selectDetailTab('next')}
                    >
                      Review next step
                    </button>
                  )}
                  {taskEditable && (
                    <label>
                      Schedule
                      <select
                        value={scheduleMode}
                        onChange={(e) =>
                          setScheduleMode(e.target.value as 'new' | 'callback')
                        }
                      >
                        <option value="new">New task or appointment</option>
                        <option value="callback">
                          Reschedule existing callback
                        </option>
                      </select>
                    </label>
                  )}
                  <label>
                    Title
                    <input
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      required
                      maxLength={200}
                      placeholder="Describe the action"
                    />
                  </label>
                  <div className={styles.attachedLead}>
                    <small>Attached to Lead</small>
                    <strong>{t.name}</strong>
                  </div>
                  {scheduleMode === 'new' ? (
                    <div className={styles.agendaFilters}>
                      <label>
                        Type
                        <select
                          value={taskKind}
                          onChange={(e) =>
                            setTaskKind(e.target.value as typeof taskKind)
                          }
                        >
                          <option value="follow_up">Follow-up</option>
                          <option value="callback">Callback</option>
                          <option value="appointment">Appointment</option>
                          <option value="task">Research / task</option>
                          <option value="send_offer">Send offer</option>
                        </select>
                      </label>
                      <label>
                        Assigned to
                        <select
                          value={taskAssignee}
                          onChange={(e) => setTaskAssignee(e.target.value)}
                        >
                          {data.members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                              {m.id === data.actorId ? ' (me)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <small>Callback · {owner?.name ?? 'Unassigned'}</small>
                  )}
                  {scheduleMode === 'new' && taskKind === 'appointment' && (
                    <p>
                      CRM appointment only. Google Calendar is not connected; no
                      invitation will be sent.
                    </p>
                  )}
                  <label>
                    {scheduleMode === 'callback'
                      ? 'Follow-up time (Chicago)'
                      : 'Date and time (Chicago)'}
                    <input
                      type="datetime-local"
                      required
                      value={schedule}
                      onChange={(e) => setSchedule(e.target.value)}
                    />
                  </label>
                  <label>
                    Notes (optional)
                    <textarea
                      aria-label="Task notes"
                      rows={2}
                      maxLength={2000}
                      value={taskNote}
                      onChange={(e) => setTaskNote(e.target.value)}
                      placeholder="Additional details…"
                    />
                  </label>
                  <div className={styles.taskFooter}>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => {
                        setSchedule('')
                        setTaskTitle(t.callback_title ?? 'Call seller')
                        setTaskNote(t.callback_notes ?? '')
                        setSchedulerOpen(false)
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.primary}
                      disabled={
                        blocked ||
                        !schedule ||
                        !taskTitle.trim() ||
                        !canWork ||
                        !owns ||
                        !t.lead_id ||
                        hasCrmIssue(t) ||
                        (scheduleMode === 'callback' && !taskEditable)
                      }
                    >
                      {scheduleMode === 'callback'
                        ? 'Save follow-up'
                        : taskKind === 'appointment'
                          ? 'Save appointment'
                          : 'Create task'}
                    </button>
                  </div>
                </form>
              </div>
            </>
            <EmailCalendarAgenda thread={t} asOf={data.asOf} />
            {taskEditable && (
              <>
                <details className={styles.outcomeDisclosure}>
                  <summary>Record call outcome</summary>
                  <form
                    className={styles.drawerForm}
                    onSubmit={async (e) => {
                      e.preventDefault()
                      setLocalError('')
                      let nextDueAt: string | undefined
                      if (outcomeRemainsOpen) {
                        try {
                          nextDueAt = chicagoDateTime(outcomeDue).toISOString()
                        } catch {
                          setLocalError('Choose a valid Chicago date and time.')
                          return
                        }
                      }
                      const r = await act({
                        command: 'HAN-OUTCOME',
                        idempotencyKey: crypto.randomUUID(),
                        expectedRevision: scheduleRevision.handoff,
                        payload: {
                          handoffId: t.handoff_id!,
                          outcome: outcomeKind,
                          note: outcome,
                          ...(outcomeRemainsOpen
                            ? { nextAction, nextDueAt }
                            : {}),
                          contentRevision: scheduleRevision.thread,
                        },
                      })
                      if (r) {
                        setOutcome('')
                        setOutcomeDue('')
                        setNextAction('')
                        setScheduleRevision({
                          thread: t.content_revision,
                          controller: t.controller_revision,
                          handoff: scheduleRevision.handoff + 1,
                        })
                      }
                    }}
                  >
                    <label>
                      Result
                      <select
                        aria-label="Call result"
                        value={outcomeKind}
                        onChange={(e) =>
                          setOutcomeKind(e.target.value as typeof outcomeKind)
                        }
                      >
                        <option value="conversation_complete">
                          Conversation complete
                        </option>
                        <option value="follow_up">Follow-up needed</option>
                        <option value="no_contact">No contact</option>
                        <option value="not_qualified">
                          Not a fit for this outreach
                        </option>
                      </select>
                    </label>
                    <label>
                      Call outcome
                      <textarea
                        aria-label="Call outcome"
                        rows={2}
                        required
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                        maxLength={2000}
                      />
                    </label>
                    {outcomeRemainsOpen && (
                      <>
                        <label>
                          Next action
                          <input
                            value={nextAction}
                            onChange={(e) => setNextAction(e.target.value)}
                            required
                            maxLength={200}
                          />
                        </label>
                        <label>
                          Next action time (Chicago)
                          <input
                            type="datetime-local"
                            value={outcomeDue}
                            onChange={(e) => setOutcomeDue(e.target.value)}
                            required
                          />
                        </label>
                      </>
                    )}
                    <button
                      disabled={
                        blocked ||
                        !outcome.trim() ||
                        (outcomeRemainsOpen &&
                          (!nextAction.trim() || !outcomeDue))
                      }
                    >
                      {outcomeRemainsOpen
                        ? 'Save outcome & follow-up'
                        : 'Complete callback'}
                    </button>
                    <small>
                      {outcomeRemainsOpen
                        ? 'Keeps this callback open with its next action.'
                        : 'Completes this callback only. The CRM stage stays unchanged.'}
                    </small>
                  </form>
                </details>
                <details
                  className={styles.outcomeDisclosure}
                  open={qualifyOpen}
                  onToggle={(e) =>
                    setQualifyOpen((e.target as HTMLDetailsElement).open)
                  }
                >
                  <summary>Qualify as Opportunity</summary>
                  <form
                    className={styles.drawerForm}
                    onSubmit={async (e) => {
                      e.preventDefault()
                      if (!qualifyReady || !t.handoff_id || !t.lead_id || !inbound)
                        return
                      const evidence = {
                        state: 'verified' as const,
                        evidenceIds: [inbound.id],
                      }
                      const r = await act({
                        command: 'HAN-QUALIFY',
                        idempotencyKey: crypto.randomUUID(),
                        expectedRevision: scheduleRevision.handoff,
                        payload: {
                          handoffId: t.handoff_id,
                          leadId: t.lead_id,
                          leadRevision: Math.round(Number(t.lead_revision)),
                          nextAction: qualifyNext.trim(),
                          evidenceIds: [inbound.id],
                          assessment: {
                            personAuthority: {
                              state: 'confirmed',
                              evidenceIds: [inbound.id],
                            },
                            propertyRef: t.property?.address ?? '',
                            timeline: {
                              ...evidence,
                              note: qualifyPillars.timeline.trim(),
                            },
                            condition: {
                              ...evidence,
                              note: qualifyPillars.condition.trim(),
                            },
                            motivation: {
                              ...evidence,
                              note: qualifyPillars.motivation.trim(),
                            },
                            price: {
                              ...evidence,
                              note: qualifyPillars.price.trim(),
                            },
                            whyWorthPursuing: qualifyWhy.trim(),
                          },
                        },
                      })
                      if (r) {
                        setQualifyOpen(false)
                        setQualifyWhy('')
                        setQualifyNext('')
                      }
                    }}
                  >
                    <p>
                      Uses the existing human four-pillar policy and the current
                      Lead revision. Unknown facts cannot be invented to
                      qualify.
                    </p>
                    {(
                      [
                        ['timeline', 'Timeline'],
                        ['condition', 'Condition'],
                        ['motivation', 'Motivation'],
                        ['price', 'Price'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <textarea
                          aria-label={`${label} evidence`}
                          rows={2}
                          required
                          value={qualifyPillars[key]}
                          onChange={(e) =>
                            setQualifyPillars((current) => ({
                              ...current,
                              [key]: e.target.value,
                            }))
                          }
                          maxLength={2000}
                        />
                      </label>
                    ))}
                    <label>
                      Why this is worth pursuing
                      <textarea
                        aria-label="Why this is worth pursuing"
                        rows={2}
                        required
                        value={qualifyWhy}
                        onChange={(e) => setQualifyWhy(e.target.value)}
                        maxLength={2000}
                      />
                    </label>
                    <label>
                      Next action
                      <input
                        aria-label="Qualification next action"
                        value={qualifyNext}
                        onChange={(e) => setQualifyNext(e.target.value)}
                        required
                        maxLength={2000}
                      />
                    </label>
                    <button disabled={blocked || !qualifyReady}>
                      Qualify as Opportunity
                    </button>
                    <small>
                      Missing verified evidence:{' '}
                      {(t.qualification_missing ?? []).join(', ') ||
                        'none stored yet — complete all four fields above.'}
                    </small>
                  </form>
                </details>
              </>
            )}
          </section>
          <section
            role="tabpanel"
            id="details-panel-notes"
            aria-labelledby="details-tab-notes"
            hidden={detailTab !== 'notes'}
            tabIndex={0}
            className={styles.detailPanel}
          >
            {canWork && t.lead_id ? (
              <form
                className={styles.drawerForm}
                onSubmit={async (e) => {
                  e.preventDefault()
                  const r = await act({
                    command: 'THR-NOTE',
                    idempotencyKey: crypto.randomUUID(),
                    payload: { threadId: t.id, body: note },
                  })
                  if (r) setNote('')
                }}
              >
                <label>
                  Add a note
                  <textarea
                    aria-label="Add a note"
                    rows={2}
                    value={note}
                    required
                    maxLength={2000}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button disabled={blocked || !note.trim()}>Save note</button>
              </form>
            ) : (
              <small>
                Notes are saved on the linked CRM record. Link the Lead first.
              </small>
            )}
            {(t.notes ?? []).map((n) => (
              <article key={n.id} className={styles.note}>
                <p>{n.body}</p>
                <small>
                  {n.author ?? 'Team'} · {time(n.created_at)}
                </small>
              </article>
            ))}
          </section>

          <section
            role="tabpanel"
            id="details-panel-ari"
            aria-labelledby="details-tab-ari"
            hidden={detailTab !== 'ari'}
            tabIndex={0}
            className={styles.detailPanel}
          >
            <div className={styles.insightStatus}>
              <strong>
                {data.ai_available
                  ? 'Ari’s saved analysis'
                  : 'Live insights aren’t connected yet'}
              </strong>
              <p>
                {data.ai_available
                  ? 'Prepare a reply in Next step. Ari’s analysis stays tied to the conversation it reviewed.'
                  : 'The context below comes from this saved conversation. It is not an AI assessment.'}
              </p>
            </div>
            <button onClick={() => selectDetailTab('next')}>
              Go to Next step
            </button>
            {t.ai_generation && (
              <div className={styles.insightCard}>
                <h4>Saved generation · {t.ai_generation.state}</h4>
                <small>{time(t.ai_generation.created_at)}</small>
                {t.ai_generation.state === 'ready' &&
                  t.ai_generation.output && (
                    <>
                      <p>{t.ai_generation.output.summary}</p>
                      <p>{t.ai_generation.output.reason}</p>
                      {t.ai_generation.output.evidence.map((e, i) => (
                        <blockquote key={i}>{e.quote}</blockquote>
                      ))}
                    </>
                  )}
                <details>
                  <summary>Generation details</summary>
                  <p>Model: {t.ai_generation.model}</p>
                  <p>
                    Estimated cost:{' '}
                    {t.ai_generation.estimated_cost_usd === null
                      ? 'Unavailable'
                      : `$${Number(t.ai_generation.estimated_cost_usd).toFixed(5)}`}
                  </p>
                  <p>Reference: {t.ai_generation.id}</p>
                </details>
              </div>
            )}
            <div className={styles.insightCard}>
              <h4>Seller’s latest reply</h4>
              {inbound ? (
                <blockquote>{inbound.text_body}</blockquote>
              ) : (
                <p>No reply received yet.</p>
              )}
            </div>
          </section>
        </aside>
      )}
    </div>
  )
}
