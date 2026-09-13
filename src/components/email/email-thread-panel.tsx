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

const detailTabs = [
  ['contact', 'Contact'],
  ['property', 'Property'],
  ['followups', 'Calendar'],
  ['notes', 'Notes'],
  ['ari', 'Ari’s Insights'],
] as const
type DetailTab = (typeof detailTabs)[number][0]

function DetailIcon({ tab }: { tab: DetailTab }) {
  const paths: Record<DetailTab, string> = {
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
  const [detailTab, setDetailTab] = useState<DetailTab>('contact')
  const [composing, setComposing] = useState(false)
  const [older, setOlder] = useState(false)
  const [note, setNote] = useState('')
  const [schedule, setSchedule] = useState('')
  const [taskTitle, setTaskTitle] = useState(t.callback_title ?? 'Call seller')
  const [taskNote, setTaskNote] = useState(t.callback_notes ?? '')
  const [outcome, setOutcome] = useState('')
  const [localError, setLocalError] = useState('')
  const [working, setWorking] = useState(false)
  const [scheduleRevision, setScheduleRevision] = useState({
    thread: t.content_revision,
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
  const blocked = busy || working
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
        handoff: t.handoff_revision ?? 0,
      })
    }
  }
  const openDetails = (tab: DetailTab = detailTab) => {
    setDetailTab(tab)
    setDetails(true)
    setScheduleRevision({
      thread: t.content_revision,
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
                {t.crm_callback_repair_required
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
                Repairs update existing CRM records only; they send no messages
                or calls.
              </small>
            </>
          ) : t.state === 'done' ? (
            <p>No remaining work. A new reply will return here.</p>
          ) : t.state === 'stopped' ? (
            <p>Marketing is stopped. The message history remains available.</p>
          ) : (
            <>
              {t.scheduled_for ? (
                <p>
                  {time(t.scheduled_for)} · Manual follow-up task, no calendar
                  invitation.
                </p>
              ) : t.requested_contact?.requestedTimeText ? (
                <p>
                  Seller asked for “{t.requested_contact.requestedTimeText}”.
                  Confirm a specific time.
                </p>
              ) : proposal?.phone ? (
                <p>
                  Phone provided: {proposal.phone}. Contact details are ready
                  for your approval.
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
                  disabled={blocked}
                  onClick={() => openDetails('followups')}
                >
                  {t.scheduled_for
                    ? 'Update follow-up / record outcome'
                    : 'Set follow-up / record outcome'}
                </button>
              )}
              {owns && proposal?.body && !t.reply_queued && (
                <div className={styles.suggestion}>
                  <small>Practice suggestion · Live AI is not connected</small>
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
                        composer.current?.focus()
                      }}
                    >
                      Edit reply
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
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
                  ? 'Received'
                  : localSimulation
                    ? 'Sent · simulated'
                    : 'Sent'}
              </small>
              <MessageBody body={m.text_body} />
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
            {taskEditable && (
              <>
                <form
                  className={styles.drawerForm}
                  onSubmit={async (e) => {
                    e.preventDefault()
                    setLocalError('')
                    let start: Date
                    try {
                      start = chicagoDateTime(schedule)
                    } catch {
                      setLocalError('Choose a valid Chicago date and time.')
                      return
                    }
                    const result = await act({
                      command: 'HAN-SCHEDULE',
                      idempotencyKey: crypto.randomUUID(),
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
                    })
                    if (result) {
                      setSchedule('')
                      setScheduleRevision({
                        thread: t.content_revision,
                        handoff: scheduleRevision.handoff + 1,
                      })
                    }
                  }}
                >
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
                  <div className={styles.taskFacts}>
                    <div>
                      <small>Type</small>
                      <span>Follow-up</span>
                    </div>
                    <div>
                      <small>Assigned to</small>
                      <span>{owner?.name ?? 'Unassigned'}</span>
                    </div>
                    <div>
                      <small>Role</small>
                      <span>Acquisitions</span>
                    </div>
                  </div>
                  <label>
                    Follow-up time (Chicago)
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
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.primary}
                      disabled={blocked || !schedule || !taskTitle.trim()}
                    >
                      Save follow-up
                    </button>
                  </div>
                </form>
                <details className={styles.outcomeDisclosure}>
                  <summary>Record call outcome</summary>
                  <form
                    className={styles.drawerForm}
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const r = await act({
                        command: 'HAN-OUTCOME',
                        idempotencyKey: crypto.randomUUID(),
                        expectedRevision: scheduleRevision.handoff,
                        payload: {
                          handoffId: t.handoff_id!,
                          outcome: 'conversation_complete',
                          note: outcome,
                          contentRevision: scheduleRevision.thread,
                        },
                      })
                      if (r) setOutcome('')
                    }}
                  >
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
                    <button disabled={blocked || !outcome.trim()}>
                      Complete callback
                    </button>
                    <small>
                      Completes this task. Does not qualify an Opportunity.
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
              <strong>Live insights aren’t connected yet</strong>
              <p>
                The context below comes from this saved conversation. It is not
                an AI assessment.
              </p>
            </div>
            <div className={styles.insightCard}>
              <h4>Next step</h4>
              <p>{title}</p>
              <p>Assigned to {owner?.name ?? 'an unassigned agent'}.</p>
              {taskEditable && (
                <button onClick={() => openDetails('followups')}>
                  Open follow-up
                </button>
              )}
            </div>
            <div className={styles.insightCard}>
              <h4>Seller’s latest reply</h4>
              {inbound ? (
                <blockquote>{inbound.text_body}</blockquote>
              ) : (
                <p>No reply received yet.</p>
              )}
            </div>
            {proposal?.body && (
              <div className={styles.insightCard}>
                <h4>Prepared practice reply</h4>
                <p>{proposal.body}</p>
                {owns && (
                  <button
                    disabled={blocked || Boolean(t.reply_queued)}
                    onClick={() => {
                      setEditor({
                        body: proposal.body,
                        revision: t.content_revision,
                        controller: t.controller_revision,
                      })
                      closeDetails()
                      requestAnimationFrame(() => composer.current?.focus())
                    }}
                  >
                    Edit this reply
                  </button>
                )}
              </div>
            )}
          </section>
        </aside>
      )}
    </div>
  )
}
