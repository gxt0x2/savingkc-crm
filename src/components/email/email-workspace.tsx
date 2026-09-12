'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import {
  matchesView,
  type InboxView,
  type PilotConfig,
  type PilotReview,
  type PilotState,
  type PilotThread,
} from '@/lib/email/workflow/types'
import styles from './email-workspace.module.css'

const views: [InboxView, string][] = [
  ['action', 'Needs action'],
  ['review', 'Needs review'],
  ['calls', 'Calls & appointments'],
  ['ai', 'AI handling'],
  ['waiting', 'Waiting'],
  ['stopped', 'Closed & stopped'],
  ['all', 'All conversations'],
]
const friendly: Record<string, string> = {
  EMAIL_SETUP_REQUIRED:
    'Email is not connected yet. The local build is available for testing; live sending remains off.',
  EMAIL_UNAVAILABLE:
    'Email could not be loaded. Your saved work has not been cleared. Try again.',
  SIGN_IN_REQUIRED: 'Sign in to the CRM to open Email.',
  NO_EMAIL_MEMBERSHIP:
    'Your account does not have access to the Email workspace.',
  REVIEW_CHANGED:
    'Recipients or campaign details changed. Review them again before starting.',
  DRAFT_CHANGED: 'This draft changed. Refresh and review the current version.',
  OWNERSHIP_CHANGED:
    'Another action changed who controls this conversation. Refresh before continuing.',
  NEW_REPLY_REVIEW_REQUIRED:
    'A new reply arrived. Read it and save a fresh draft.',
  THREAD_STOPPED:
    'Marketing is stopped for this person. This conversation cannot send.',
  WORKSPACE_PAUSED:
    'The workspace is paused. No simulated messages will be processed.',
  TAKE_OVER_FIRST:
    'Take over this conversation before drafting a response or arranging a call.',
  HANDOFF_ALREADY_EXISTS: 'This conversation already has a callback handoff.',
  FORBIDDEN: 'Your Email role cannot perform this action.',
  PHONE_EVIDENCE_REQUIRED:
    'The phone number must appear in the selected seller message.',
  TIME_EVIDENCE_REQUIRED:
    'Use the exact time wording from the selected seller message.',
}
function formatTime(value: string | null) {
  if (!value) return 'None'
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value)) + ' CT'
  )
}
function pilotDefaults(audienceId: string): PilotConfig {
  return {
    audienceId,
    senderIds: ['00000000-0000-4000-8000-000000000004'],
    playbookVersionId: '00000000-0000-4000-8000-000000000005',
    mode: 'draft_only',
    copyMode: 'template',
    draftGenerationBudget: 0,
    steps: [
      {
        id: '00000000-0000-4000-8000-000000000006',
        delayMinCalendarDays: 0,
        delayMaxCalendarDays: 0,
        targetCalendarDay: 0,
        subject: 'A question about your property',
        bodyTemplate:
          'Hi there,\n\nWould selling your property be something you would consider, or is keeping it the better fit right now?\n\nSavingKC\nLocal practice message — no email will be sent.',
      },
      {
        id: '00000000-0000-4000-8000-000000000007',
        delayMinCalendarDays: 7,
        delayMaxCalendarDays: 10,
        targetCalendarDay: 8,
        subject: 'Re: A question about your property',
        bodyTemplate:
          'Hi there,\n\nIt sounds like this may not be a priority right now. Would you prefer I leave it here?\n\nSavingKC\nLocal practice message — no email will be sent.',
      },
    ],
    timezone: 'America/Chicago',
    weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    startLocal: '09:00',
    endLocal: '17:00',
    dailyLimit: 10,
    hourlyLimit: 2,
    maxRecipients: 10,
    dailyCostCap: 0,
    totalCostCap: 0,
    recontactDays: 90,
    expiresAt: '2026-12-31T23:59:59.000Z',
    replyActions: [],
    requiredPermissionBasis: 'Fabricated local practice recipients only',
  }
}

export function EmailWorkspace({
  localSimulation = false,
}: {
  localSimulation?: boolean
}) {
  const [data, setData] = useState<PilotState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState<EmailCommand | null>(null)
  const [section, setSection] = useState<'inbox' | 'campaigns' | 'more'>(
    'inbox',
  )
  const [view, setView] = useState<InboxView>('action')
  const [mine, setMine] = useState(true)
  const [search, setSearch] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')
  const [threadId, setThreadId] = useState<string | null>(null)
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [campaignTab, setCampaignTab] = useState<
    'Summary' | 'Recipients' | 'Sequence' | 'Activity'
  >('Summary')
  const [config, setConfig] = useState<PilotConfig | null>(null)
  const [review, setReview] = useState<PilotReview | null>(null)
  const [newName, setNewName] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [callback, setCallback] = useState(false)
  const [phone, setPhone] = useState('')
  const [timeText, setTimeText] = useState('')
  const [owner, setOwner] = useState('')
  const [showSimulation, setShowSimulation] = useState(false)
  const [simulationBody, setSimulationBody] = useState(
    'I might consider selling. Call me at 816-555-0101. Tomorrow afternoon works.',
  )

  const refresh = useCallback(async () => {
    const response = await fetch('/api/email/workspace', { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error?.code ?? body.error)
    setData(body)
    return body as PilotState
  }, [])
  useEffect(() => {
    let cancelled = false
    refresh()
      .catch((e) => {
        if (!cancelled) setError(friendly[e.message] ?? e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function act(command: EmailCommand) {
    setBusy(true)
    setError('')
    setNotice('')
    setRetry(null)
    try {
      let response: Response
      try {
        response = await fetch('/api/email/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        })
      } catch {
        setRetry(command)
        throw new Error(
          'The response was interrupted. Retry the same action safely, or refresh to check its saved result.',
        )
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.code ?? body.error)
      await refresh()
      setNotice(
        'Saved. ' +
          ({
            draft: 'Draft updated.',
            simulation_active:
              'Practice campaign started. Delivery is simulated.',
            human: 'You control this conversation.',
            draft_saved: 'Reply draft saved.',
            queued_simulation: 'Reply queued for simulated delivery.',
            marketing_stopped:
              'Marketing stopped across campaigns and confirmed aliases.',
            handoff_saved_calendar_not_connected:
              'Callback handoff saved. No calendar booking or CRM Lead was created.',
            acknowledged: 'Notification acknowledged.',
            paused: 'Sending paused.',
          }[body.state as string] ?? ''),
      )
      return body as { entityId: string; state: string }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'EMAIL_UNAVAILABLE'
      setError(friendly[message] ?? message)
      return null
    } finally {
      setBusy(false)
    }
  }
  async function fetchReview(id: string) {
    setBusy(true)
    setError('')
    setReview(null)
    try {
      const response = await fetch(`/api/email/workspace?review=${id}`, {
        cache: 'no-store',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.code ?? body.error)
      setReview(body)
      setCampaignTab('Recipients')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'EMAIL_UNAVAILABLE'
      setError(friendly[message] ?? message)
    } finally {
      setBusy(false)
    }
  }
  async function simulate(kind: 'deliver' | 'inbound') {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/email/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          requestId: crypto.randomUUID(),
          threadId,
          body: simulationBody,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.code ?? body.error)
      await refresh()
      setNotice(
        body.state === 'accepted_simulated'
          ? 'One message accepted by the simulated transport.'
          : body.state === 'received_sequence_stopped'
            ? 'Practice reply received. Pending sequence messages are stopped.'
            : body.state.replaceAll('_', ' '),
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'EMAIL_UNAVAILABLE'
      setError(friendly[message] ?? message)
    } finally {
      setBusy(false)
    }
  }

  const campaign = data?.campaigns.find((c) => c.id === campaignId)
  const scoped = (data?.threads ?? []).filter(
    (t) =>
      (!mine ||
        t.responsible_user_id === data?.actorId ||
        t.controller_user_id === data?.actorId) &&
      (!campaignFilter || t.campaign_id === campaignFilter) &&
      `${t.name} ${t.email} ${t.subject} ${data?.messages
        .filter((m) => m.thread_id === t.id)
        .map((m) => m.text_body)
        .join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  const visible = scoped.filter((t) => matchesView(t, view))
  const selected = visible.find((t) => t.id === threadId)
  const messages =
    data?.messages.filter((m) => m.thread_id === selected?.id) ?? []
  const latestInbound = messages.filter((m) => m.direction === 'inbound').at(-1)
  const savedDraft = data?.drafts.findLast(
    (d) => d.thread_id === selected?.id && d.state === 'current',
  )
  const owns =
    selected &&
    selected.controller_user_id === data?.actorId &&
    selected.state !== 'stopped'
  const canManage = data?.roles.some((r) => ['owner', 'marketer'].includes(r))
  const canWork = data?.roles.some((r) =>
    ['owner', 'reviewer', 'acquisitions'].includes(r),
  )
  const campaignChoices = Array.from(
    new Map(
      (data?.threads ?? []).map((t) => [t.campaign_id, t.campaign_name]),
    ).entries(),
  )

  function selectThread(thread: PilotThread) {
    setThreadId(thread.id)
    setDraftBody(
      data?.drafts.findLast(
        (d) => d.thread_id === thread.id && d.state === 'current',
      )?.body ?? '',
    )
    setCallback(false)
    setPhone('')
    setTimeText('')
    setOwner(data?.actorId ?? '')
    setNotice('')
    setError('')
  }
  function selectCampaign(id: string) {
    const selected = data?.campaigns.find((c) => c.id === id)
    setCampaignId(id)
    setConfig(
      selected?.draft_config.steps
        ? (selected.draft_config as PilotConfig)
        : pilotDefaults(data?.audiences[0]?.id ?? ''),
    )
    setReview(null)
    setCampaignTab('Summary')
  }
  async function createCampaign(event: FormEvent) {
    event.preventDefault()
    const result = await act({
      command: 'CAM-CREATE',
      idempotencyKey: crypto.randomUUID(),
      payload: { name: newName, program: 'seller_outreach' },
    })
    if (result) {
      setCampaignId(result.entityId)
      setConfig(pilotDefaults(data?.audiences[0]?.id ?? ''))
      setCampaignTab('Sequence')
      setReview(null)
      setNewName('')
    }
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>SAVINGKC / OUTREACH</div>
          <h1>Email</h1>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.mode}>
            {data?.paused ? 'Paused' : 'Live sending off'}
          </span>
          <button
            disabled={busy}
            onClick={() => {
              setError('')
              refresh().catch((e) => setError(friendly[e.message] ?? e.message))
            }}
          >
            Refresh
          </button>
        </div>
      </header>
      <nav aria-label="Email workspace" className={styles.nav}>
        {(['inbox', 'campaigns', 'more'] as const).map((tab) => (
          <button
            key={tab}
            aria-current={section === tab ? 'page' : undefined}
            onClick={() => setSection(tab)}
          >
            {tab === 'inbox'
              ? 'Inbox'
              : tab === 'campaigns'
                ? 'Campaigns'
                : 'More'}
          </button>
        ))}
      </nav>
      <div className={styles.banner}>
        <strong>
          {data?.mode === 'simulation'
            ? 'Local practice workspace'
            : 'Email setup pending'}
        </strong>
        <span>
          {data?.mode === 'simulation'
            ? 'Fabricated contacts. Messages are saved locally; no email, call, push or calendar event is sent.'
            : 'Your team will work here once the remaining integrations are connected and verified.'}
        </span>
      </div>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          {retry && (
            <button disabled={busy} onClick={() => act(retry)}>
              Retry same action
            </button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {loading ? (
        <p className={styles.empty}>Loading Email…</p>
      ) : !data ? (
        <div className={styles.empty}>
          <h2>Email isn’t available yet</h2>
          <p>Saved data will appear here when the connection is ready.</p>
        </div>
      ) : (
        <>
          {section === 'inbox' && (
            <>
              <div className={styles.heading}>
                <div>
                  <h2>Inbox</h2>
                  <p>Focus on the conversations that need you.</p>
                </div>
                <span className={styles.muted}>
                  As of {formatTime(data.asOf)}
                </span>
              </div>
              <div className={styles.filters}>
                <label>
                  Search
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name, email or message"
                  />
                </label>
                <label>
                  Owner
                  <select
                    value={mine ? 'mine' : 'team'}
                    onChange={(e) => setMine(e.target.value === 'mine')}
                  >
                    <option value="mine">Mine</option>
                    <option value="team">Team I can access</option>
                  </select>
                </label>
                <label>
                  Campaign
                  <select
                    value={campaignFilter}
                    onChange={(e) => setCampaignFilter(e.target.value)}
                  >
                    <option value="">All campaigns</option>
                    {campaignChoices.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                {(search || campaignFilter || !mine) && (
                  <button
                    onClick={() => {
                      setSearch('')
                      setCampaignFilter('')
                      setMine(true)
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
              <div className={styles.views} aria-label="Inbox views">
                {views.map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                  >
                    {label}
                    <span>
                      {scoped.filter((t) => matchesView(t, key)).length}
                    </span>
                  </button>
                ))}
              </div>
              <div className={styles.inbox}>
                <section
                  className={styles.threadList}
                  aria-label="Conversations"
                >
                  <div className={styles.listTitle}>
                    {visible.length} conversations
                  </div>
                  {!visible.length && (
                    <div className={styles.empty}>
                      <h3>Nothing in this view</h3>
                      <p>
                        Waiting conversations and stopped marketing have their
                        own views.
                      </p>
                    </div>
                  )}
                  {visible.map((t) => (
                    <button
                      key={t.id}
                      className={
                        selected?.id === t.id
                          ? styles.selectedThread
                          : styles.thread
                      }
                      onClick={() => selectThread(t)}
                    >
                      <span className={styles.row}>
                        <strong>{t.name}</strong>
                        <small>
                          {t.handoff_state === 'held'
                            ? 'Contact on hold'
                            : t.handoff_id
                              ? 'Callback'
                              : t.state.replaceAll('_', ' ')}
                        </small>
                      </span>
                      <span>{t.subject}</span>
                      <small>
                        {t.campaign_name} ·{' '}
                        {t.controller === 'human'
                          ? 'Human controlled'
                          : 'Sequence'}
                      </small>
                    </button>
                  ))}
                </section>
                <section
                  className={styles.conversation}
                  aria-label="Selected conversation"
                >
                  {!selected ? (
                    <div className={styles.empty}>
                      <h3>Select a conversation</h3>
                      <p>See the complete history and the next action here.</p>
                    </div>
                  ) : (
                    <>
                      <div className={styles.conversationHeader}>
                        <div>
                          <h3>{selected.name}</h3>
                          <p>{selected.email}</p>
                        </div>
                        <span className={styles.badge}>
                          {selected.outcome === 'unsubscribed'
                            ? 'Unsubscribed'
                            : selected.state === 'stopped'
                              ? 'Marketing stopped'
                              : selected.controller === 'human'
                                ? owns
                                  ? 'You control this'
                                  : 'Agent controlled'
                                : 'Not assigned to a person'}
                        </span>
                      </div>
                      {selected.handoff_id && (
                        <div className={styles.banner}>
                          <strong>
                            {selected.handoff_state === 'held'
                              ? 'Callback needs review — marketing stopped'
                              : 'Callback handoff saved'}
                          </strong>
                          <span>
                            {selected.requested_contact?.phone}{' '}
                            {selected.requested_contact?.requestedTimeText} · No
                            calendar booking. CRM sync is not connected.
                          </span>
                        </div>
                      )}
                      <div className={styles.messages}>
                        {messages.length ? (
                          messages.map((m) => (
                            <article
                              key={m.id}
                              className={
                                m.direction === 'inbound'
                                  ? styles.incoming
                                  : styles.outgoing
                              }
                            >
                              <div className={styles.row}>
                                <strong>
                                  {m.direction === 'inbound'
                                    ? selected.name
                                    : 'SavingKC · simulated'}
                                </strong>
                                <small>{formatTime(m.occurred_at)}</small>
                              </div>
                              <p>{m.text_body}</p>
                            </article>
                          ))
                        ) : (
                          <p className={styles.muted}>
                            The first message is queued. No delivery has
                            occurred.
                          </p>
                        )}
                      </div>
                      <div className={styles.actions}>
                        {canWork && selected.state !== 'stopped' && !owns && (
                          <button
                            className={styles.primary}
                            disabled={busy}
                            onClick={() =>
                              act({
                                command: 'THR-TAKEOVER',
                                idempotencyKey: crypto.randomUUID(),
                                payload: {
                                  threadId: selected.id,
                                  expectedControllerRevision:
                                    selected.controller_revision,
                                },
                              })
                            }
                          >
                            Take over
                          </button>
                        )}
                        {owns && latestInbound && !selected.handoff_id && (
                          <button
                            disabled={busy}
                            onClick={() => setCallback(!callback)}
                          >
                            Arrange callback
                          </button>
                        )}
                        {canWork && selected.state !== 'stopped' && (
                          <button
                            className={styles.danger}
                            disabled={busy}
                            onClick={() =>
                              act({
                                command: 'SUP-ADD',
                                idempotencyKey: crypto.randomUUID(),
                                payload: {
                                  addressIds: [selected.address_id],
                                  scope: 'all_marketing',
                                  reason: 'manual',
                                },
                              })
                            }
                          >
                            Stop marketing
                          </button>
                        )}
                      </div>
                      {callback && owns && latestInbound && (
                        <form
                          className={styles.form}
                          onSubmit={async (e) => {
                            e.preventDefault()
                            const result = await act({
                              command: 'THR-HANDOFF',
                              expectedRevision: selected.content_revision,
                              idempotencyKey: crypto.randomUUID(),
                              payload: {
                                threadId: selected.id,
                                ownerId: owner,
                                backupId: data.actorId,
                                reason: 'Human-reviewed callback request',
                                requestedContact: {
                                  ...(phone ? { phone } : {}),
                                  ...(timeText
                                    ? { requestedTimeText: timeText }
                                    : {}),
                                },
                                factEvidence: [
                                  {
                                    source: 'message',
                                    messageId: latestInbound.id,
                                    quote: latestInbound.text_body,
                                  },
                                ],
                              },
                            })
                            if (result) setCallback(false)
                          }}
                        >
                          <h3>Arrange a call</h3>
                          <p>
                            This saves a handoff, not an appointment. Copy the
                            phone and preferred time from the seller’s message.
                          </p>
                          <label>
                            Assigned agent
                            <select
                              value={owner}
                              onChange={(e) => setOwner(e.target.value)}
                              required
                            >
                              {data.members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Phone from this reply
                            <input
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                            />
                          </label>
                          <label>
                            Seller’s exact time wording
                            <input
                              value={timeText}
                              onChange={(e) => setTimeText(e.target.value)}
                            />
                          </label>
                          <button className={styles.primary} disabled={busy}>
                            Save callback handoff
                          </button>
                        </form>
                      )}
                      {owns && (
                        <div className={styles.form}>
                          <label>
                            Reply draft
                            <textarea
                              rows={4}
                              value={draftBody}
                              onChange={(e) => setDraftBody(e.target.value)}
                              placeholder="Acknowledge what they said, then ask one useful question."
                            />
                          </label>
                          <div className={styles.actions}>
                            <button
                              disabled={busy || !draftBody.trim()}
                              onClick={() =>
                                act({
                                  command: 'THR-DRAFT',
                                  idempotencyKey: crypto.randomUUID(),
                                  payload: {
                                    threadId: selected.id,
                                    body: draftBody,
                                    contentRevision: selected.content_revision,
                                    controllerRevision:
                                      selected.controller_revision,
                                  },
                                })
                              }
                            >
                              Save reply draft
                            </button>
                            {savedDraft && (
                              <button
                                disabled={busy || savedDraft.body !== draftBody}
                                onClick={() =>
                                  act({
                                    command: 'THR-SEND',
                                    idempotencyKey: crypto.randomUUID(),
                                    payload: {
                                      draftId: savedDraft.id,
                                      bodyHash: savedDraft.body_hash,
                                      contentRevision:
                                        savedDraft.content_revision,
                                      controllerRevision:
                                        savedDraft.controller_revision,
                                    },
                                  })
                                }
                              >
                                Queue simulated reply
                              </button>
                            )}
                          </div>
                          <small>
                            Saved drafts are invalidated when new replies arrive
                            or control changes.
                          </small>
                        </div>
                      )}
                    </>
                  )}
                </section>
              </div>
            </>
          )}
          {section === 'campaigns' && (
            <>
              <div className={styles.heading}>
                <div>
                  <h2>Campaigns</h2>
                  <p>
                    Review recipients and cadence before each campaign starts.
                  </p>
                </div>
              </div>
              {canManage ? (
                <>
                  <form className={styles.create} onSubmit={createCampaign}>
                    <label>
                      Campaign name
                      <input
                        required
                        maxLength={120}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="e.g. September seller outreach"
                      />
                    </label>
                    <button
                      className={styles.primary}
                      disabled={busy || !newName.trim()}
                    >
                      New campaign
                    </button>
                  </form>
                  <div className={styles.campaignList}>
                    {!data.campaigns.length && (
                      <p className={styles.empty}>
                        No campaigns yet. Create a draft to review the complete
                        two-email sequence.
                      </p>
                    )}
                    {data.campaigns.map((c) => (
                      <button
                        key={c.id}
                        className={
                          campaignId === c.id
                            ? styles.activeCampaign
                            : styles.campaign
                        }
                        onClick={() => selectCampaign(c.id)}
                      >
                        <strong>{c.name}</strong>
                        <span>{c.state}</span>
                        <small>
                          {c.started}/{c.approved} recipients started
                        </small>
                        <small>
                          Next:{' '}
                          {data.paused || c.state === 'paused'
                            ? 'Paused'
                            : formatTime(c.next_send)}
                        </small>
                      </button>
                    ))}
                  </div>
                  {campaign && config && (
                    <section className={styles.campaignDetail}>
                      <div className={styles.heading}>
                        <div>
                          <h3>{campaign.name}</h3>
                          <p>
                            {campaign.state === 'draft'
                              ? 'Draft — save before reviewing'
                              : 'Frozen published version · simulated transport'}
                          </p>
                        </div>
                        {campaign.state === 'active' && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              act({
                                command: 'CAM-PAUSE',
                                entityId: campaign.id,
                                idempotencyKey: crypto.randomUUID(),
                                payload: { reason: 'Paused by operator' },
                              })
                            }
                          >
                            Pause this campaign
                          </button>
                        )}
                      </div>
                      <nav
                        className={styles.views}
                        aria-label="Campaign details"
                      >
                        {(
                          [
                            'Summary',
                            'Recipients',
                            'Sequence',
                            'Activity',
                          ] as const
                        ).map((tab) => (
                          <button
                            key={tab}
                            aria-pressed={campaignTab === tab}
                            onClick={() => setCampaignTab(tab)}
                          >
                            {tab}
                          </button>
                        ))}
                      </nav>
                      {campaignTab === 'Summary' && (
                        <div className={styles.form}>
                          <p>
                            <strong>
                              {campaign.approved} approved recipients ·{' '}
                              {campaign.started} started
                            </strong>
                          </p>
                          <p>
                            Two messages maximum. A reply or marketing stop ends
                            the sequence. Agents review incoming replies;
                            automatic AI responses are off.
                          </p>
                          <p>
                            Weekdays, 9 AM–5 PM America/Chicago. Follow-up
                            targets day 8 after acceptance, within 7–10 calendar
                            days.
                          </p>
                        </div>
                      )}
                      {campaignTab === 'Sequence' && (
                        <div className={styles.form}>
                          <label>
                            Recipient list
                            <select
                              disabled={campaign.state !== 'draft'}
                              value={config.audienceId}
                              onChange={(e) => {
                                setConfig({
                                  ...config,
                                  audienceId: e.target.value,
                                })
                                setReview(null)
                              }}
                            >
                              {data.audiences.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {config.steps.map((step, index) => (
                            <fieldset
                              key={step.id}
                              disabled={campaign.state !== 'draft'}
                            >
                              <legend>
                                {index === 0
                                  ? '1 · First eligible weekday'
                                  : '2 · Follow up only if no reply'}
                              </legend>
                              {index === 1 && (
                                <p className={styles.cadence}>
                                  Wait 7–10 calendar days · target day 8 · skip
                                  weekends
                                </p>
                              )}
                              <label>
                                {`Email ${index + 1} subject`}
                                <input
                                  value={step.subject}
                                  onChange={(e) => {
                                    setConfig({
                                      ...config,
                                      steps: config.steps.map((s, i) =>
                                        i === index
                                          ? { ...s, subject: e.target.value }
                                          : s,
                                      ),
                                    })
                                    setReview(null)
                                  }}
                                />
                              </label>
                              <label>
                                {`Email ${index + 1} message`}
                                <textarea
                                  rows={6}
                                  value={step.bodyTemplate}
                                  onChange={(e) => {
                                    setConfig({
                                      ...config,
                                      steps: config.steps.map((s, i) =>
                                        i === index
                                          ? {
                                              ...s,
                                              bodyTemplate: e.target.value,
                                            }
                                          : s,
                                      ),
                                    })
                                    setReview(null)
                                  }}
                                />
                              </label>
                            </fieldset>
                          ))}
                          <p className={styles.cadence}>
                            Friday, Sep 11 at 10 AM → Monday, Sep 21 at 10 AM
                            (day 10). Sending and reply eligibility are checked
                            again at dispatch.
                          </p>
                          {campaign.state === 'draft' && (
                            <button
                              className={styles.primary}
                              disabled={busy}
                              onClick={async () => {
                                const result = await act({
                                  command: 'CAM-SAVE',
                                  entityId: campaign.id,
                                  expectedRevision: Number(campaign.revision),
                                  idempotencyKey: crypto.randomUUID(),
                                  payload: { draftConfig: config },
                                })
                                if (result) setReview(null)
                              }}
                            >
                              Save sequence
                            </button>
                          )}
                        </div>
                      )}
                      {campaignTab === 'Recipients' && (
                        <div className={styles.form}>
                          {campaign.state === 'draft' ? (
                            <>
                              <p>
                                Review checks address verification, identity,
                                restrictions and enrollment in other campaigns.
                              </p>
                              <button
                                disabled={busy || !campaign.draft_config.steps}
                                onClick={() => fetchReview(campaign.id)}
                              >
                                Review saved campaign
                              </button>
                              {review && (
                                <>
                                  <h3>
                                    {
                                      review.recipients.filter(
                                        (r) => r.eligible,
                                      ).length
                                    }{' '}
                                    ready ·{' '}
                                    {
                                      review.recipients.filter(
                                        (r) => !r.eligible,
                                      ).length
                                    }{' '}
                                    excluded
                                  </h3>
                                  <div className={styles.recipients}>
                                    {review.recipients.map((r) => (
                                      <div key={r.id}>
                                        <strong>{r.name}</strong>
                                        <span>{r.email}</span>
                                        <small>
                                          {r.eligible
                                            ? 'Ready for local practice'
                                            : r.reasons.join(' · ')}
                                        </small>
                                      </div>
                                    ))}
                                  </div>
                                  <details>
                                    <summary>
                                      Exact saved messages included in this
                                      review
                                    </summary>
                                    {campaign.draft_config.steps?.map((s) => (
                                      <article key={s.id}>
                                        <h4>{s.subject}</h4>
                                        <pre>{s.bodyTemplate}</pre>
                                      </article>
                                    ))}
                                  </details>
                                  <button
                                    className={styles.primary}
                                    disabled={
                                      busy ||
                                      !review.recipients.some((r) => r.eligible)
                                    }
                                    onClick={() =>
                                      act({
                                        command: 'CAM-LAUNCH',
                                        entityId: campaign.id,
                                        expectedRevision: review.revision,
                                        idempotencyKey: crypto.randomUUID(),
                                        payload: {
                                          draftHash: review.draftHash,
                                          audienceHash: review.audienceHash,
                                          estimateHash: review.estimateHash,
                                          readinessRunId: review.readinessRunId,
                                          approvedMaxRecipients:
                                            review.recipients.filter(
                                              (r) => r.eligible,
                                            ).length,
                                        },
                                      })
                                    }
                                  >
                                    Start reviewed simulation
                                  </button>
                                </>
                              )}
                            </>
                          ) : (
                            <div className={styles.recipients}>
                              {data.threads
                                .filter((t) => t.campaign_id === campaign.id)
                                .map((t) => (
                                  <div key={t.id}>
                                    <strong>{t.name}</strong>
                                    <span>{t.email}</span>
                                    <small>
                                      {t.state.replaceAll('_', ' ')}
                                    </small>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                      {campaignTab === 'Activity' && (
                        <div className={styles.form}>
                          <p>
                            Campaign history is backed by saved versions and
                            command receipts. More → Operations shows recent
                            workspace actions.
                          </p>
                          <p>
                            Active versions cannot be edited. A new cohort
                            requires a new draft and review.
                          </p>
                        </div>
                      )}
                    </section>
                  )}
                </>
              ) : (
                <p className={styles.empty}>
                  Campaign management is available to owners and marketers. Your
                  assigned conversations remain in Inbox.
                </p>
              )}
            </>
          )}
          {section === 'more' && (
            <>
              <div className={styles.heading}>
                <div>
                  <h2>More</h2>
                  <p>Setup and troubleshooting, outside the daily inbox.</p>
                </div>
              </div>
              <div className={styles.cards}>
                <section>
                  <h3>Setup & connections</h3>
                  <p>
                    Local database:{' '}
                    {data.mode === 'simulation' ? 'connected' : 'disabled'}.
                  </p>
                  <p>
                    Resend, sender domains, Calendar, response phone and push:
                    not connected in this build.
                  </p>
                  <p>
                    The guided subscription and connection wizard is still being
                    built.
                  </p>
                </section>
                <section>
                  <h3>AI rules</h3>
                  <p>Human review only. No AI model is called.</p>
                  <p>
                    Use everyday language, supported facts and one useful
                    question. Don’t invent pain or infer selling intent from an
                    email open.
                  </p>
                </section>
                <section>
                  <h3>Notifications</h3>
                  {data.notifications.length ? (
                    data.notifications.map((n) => (
                      <div className={styles.notification} key={n.id}>
                        <span>{n.kind}</span>
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
                      </div>
                    ))
                  ) : (
                    <p>No notifications assigned to you.</p>
                  )}
                </section>
              </div>
              {canManage && (
                <section className={styles.operations}>
                  <h3>Operations</h3>
                  <p>
                    Real sending is disabled. The local transport processes at
                    most one due message per action.
                  </p>
                  <button
                    className={styles.danger}
                    disabled={busy || data.paused}
                    onClick={() =>
                      act({
                        command: 'SET-PAUSE',
                        idempotencyKey: crypto.randomUUID(),
                        payload: { reason: 'Workspace paused by operator' },
                      })
                    }
                  >
                    Pause all email work
                  </button>
                  <details>
                    <summary>Recent saved actions</summary>
                    {data.activity.map((a) => (
                      <p key={a.id}>
                        {a.action} · {formatTime(a.created_at)}
                      </p>
                    ))}
                  </details>
                </section>
              )}
            </>
          )}
          {localSimulation && canManage && (
            <section className={styles.lab}>
              <button
                aria-expanded={showSimulation}
                onClick={() => setShowSimulation(!showSimulation)}
              >
                Local testing controls
              </button>
              {showSimulation && (
                <div>
                  <p>
                    Simulated clock: {formatTime(data.asOf)}. These controls
                    exist only in the isolated test app.
                  </p>
                  <button
                    disabled={busy || data.paused}
                    onClick={() => simulate('deliver')}
                  >
                    Process next simulated message
                  </button>
                  <label htmlFor="email-practice-message">
                    Practice incoming reply
                  </label>
                  <textarea
                    id="email-practice-message"
                    value={simulationBody}
                    onChange={(e) => setSimulationBody(e.target.value)}
                    rows={3}
                  />
                  <button
                    disabled={busy || !selected}
                    onClick={() => simulate('inbound')}
                  >
                    Receive practice reply in selected conversation
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  )
}
