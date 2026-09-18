'use client'
import { EmailRecipientImport } from './email-recipient-import'
import { pilotDefaults, inheritedPropertyCopy } from './campaign-defaults'
import { EmailHostedSetup } from './email-hosted-setup'
import { EmailReceivingStatus } from './email-receiving-status'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
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
import { EmailSetup } from './email-setup'
import { EmailThreadPanel } from './email-thread-panel'
import { EmailNotifications } from './email-notifications'
import { nextWork } from '@/lib/email/workflow/presentation'
import { outreachFooter } from '@/lib/email/providers/outreach-footer'

const views: [InboxView, string][] = [
  ['action', 'To do'],
  ['waiting', 'Waiting on seller'],
  ['scheduled', 'Scheduled'],
  ['done', 'Email handled'],
  ['all', 'All'],
]
const friendly: Record<string, string> = {
  SAMPLE_DELIVERY_NOT_ACCEPTED: 'The sample was not confirmed sent. Check sending readiness before retrying; the campaign has not started.',
  CONTROLLED_TEST_ALREADY_PENDING: 'This test inbox has unfinished email work. Resolve its pending delivery or conversation before sending another sample.',
  CAMPAIGN_SENDER_TEST_REQUIRED: 'Complete the listed campaign checks, including a delivered sample and matched reply for the selected sender, before starting.',
  PERSONALIZATION_IDENTITY_REQUIRED: 'Verify the recipient’s identity before personalizing this message.',
  PERSONALIZATION_PROPERTY_REQUIRED: 'Confirm one property and record the evidence before personalizing this message.',
  PERSONALIZATION_NAME_REQUIRED: 'A verified person’s name is required for personalization.',
  CHOOSE_REVIEWED_SAMPLE_RECIPIENT: 'Choose a reviewed recipient for the sample’s name and property details.',
  SAMPLE_RECIPIENT_NOT_REVIEWED: 'This sample recipient needs identity and property review first.',
  UNSUPPORTED_PERSONALIZATION_FIELD: 'Use only first_name, property_address and property_question inside double braces.',

  NEW_CALLBACK_REQUEST_REQUIRED: 'A new explicit callback request received after marketing stopped is required. Marketing remains blocked.',
  REPLY_CONTENT_PENDING:
    'A reply arrived. Wait for its full content before acting.',
  TASK_ASSIGNEE_UNAVAILABLE:
    'Choose an active team member with access to work this conversation.',
  INVALID_TASK_TIME: 'Choose a future date and time.',
  AI_NOT_CONNECTED: 'Ari is not connected yet. Your draft has not changed.',
  AI_BUDGET_REACHED:
    'The small AI pilot allowance has been reached. You can still write replies manually.',
  AI_CONTEXT_TOO_LARGE:
    'This conversation is too long for the current AI pilot. Review and write the reply manually.',
  REPLY_REQUIRED:
    'Wait for a seller reply before asking Ari to draft a response.',
  NEXT_ACTION_REQUIRED:
    'Choose the next action and its due date before saving this outcome.',
  INVALID_OUTCOME_TIME: 'The outcome cannot be recorded in the future.',
  ASSIGNEE_UNAVAILABLE:
    'Choose an active acquisitions agent and a different backup.',
  ASSIGNEE_AMBIGUOUS:
    'Two active profiles share this name. Resolve the team profiles before assigning.',
  CRM_RECORD_HELD:
    'This CRM record is parked or closed. Review it in the CRM before continuing.',
  MULTIPLE_HANDOFFS_REQUIRE_REVIEW:
    'This Lead has another open Email handoff. Review both assignments together before changing the owner.',
  HANDOFF_NOT_RESOLVABLE:
    'This request has already been linked or its status changed. Refresh to see the current action.',
  CALLBACK_OWNER_REQUIRED: 'This callback belongs to another agent.',
  CALLBACK_OWNER_CHANGED:
    'CRM ownership changed. Resolve the assignment before updating this task.',
  HANDOFF_CHANGED:
    'This task changed. Close and reopen Details before saving again.',
  DELIVERY_RECONCILIATION_REQUIRED: 'The previous send has no confirmed outcome. Check Resend before preparing another send.',
  CALLBACK_HELD:
    'This callback is held or completed. Review its current status.',
  INVALID_CALLBACK_TIME:
    'Choose a future weekday time at 8:30 AM or later in Chicago.',
  LINK_LEAD_FIRST: 'Link the CRM Lead before saving notes or scheduled work.',
  FINISH_CALLBACK_FIRST:
    'Finish the open callback task before marking this conversation done.',
  REPLY_ALREADY_QUEUED:
    'A reply is already queued. Wait for its result or receive a new reply before sending again.',
  STALE_SETTINGS:
    'Settings changed in another session. Refresh, review the saved details and try again.',
  STALE_MEMBERSHIP:
    'This person’s access changed. Refresh before changing it again.',
  AFFECTED_WORK_CHANGED:
    'Affected conversations changed. Refresh and review the current work before changing access.',
  LAST_OWNER: 'Keep at least one active Email owner.',
  TEAM_MEMBER_INACTIVE:
    'This team member is unavailable. Choose an active team member.',
  TEAM_ROLE_REQUIRED: 'Choose an active team member with the required role.',
  DISTINCT_BACKUP_REQUIRED: 'Choose a different person as backup.',
  INVALID_TEAM_HOURS:
    'Choose weekday hours starting at 8:30 AM or later, with the end after the start.',
  INVALID_PRIMARY_DOMAIN:
    'Enter the company domain without https:// or a path.',
  HTTPS_PRIVACY_URL_REQUIRED: 'Use an https:// address for the privacy page.',
  PROVIDER_READINESS_UNAVAILABLE:
    'Sending remains off. The provider and delivery checks are not connected yet.',
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
    'A new reply arrived. Read the latest message before saving a draft or callback handoff.',
  THREAD_STOPPED:
    'Marketing is stopped for this person. This conversation cannot send.',
  WORKSPACE_PAUSED:
    'The workspace is paused. No simulated messages will be processed.',
  TAKE_OVER_FIRST:
    'Take over this conversation before drafting a response or arranging a call.',
  HANDOFF_ALREADY_EXISTS: 'This conversation already has a callback handoff.',
  CRM_REPAIR_CHANGED:
    'The pending CRM update changed. Refresh and review its current status.',
  CRM_REPAIR_NOT_FOUND: 'This pending CRM update is no longer available.',
  FORBIDDEN: 'Your Email role cannot perform this action.',
  PHONE_EVIDENCE_REQUIRED:
    'The phone number must appear in the selected seller message.',
  TIME_EVIDENCE_REQUIRED:
    'Use the exact time wording from the selected seller message.',
  CRM_IDENTITY_REVIEW_REQUIRED:
    'Confirm the seller’s identity before creating or linking a CRM Lead.',
  CRM_PROPERTY_REVIEW_REQUIRED:
    'Confirm which property this seller is discussing before creating or linking a CRM Lead.',
  CRM_DEPENDENCY_UNAVAILABLE:
    'The callback handoff is saved, but CRM linking needs attention.',
  STALE_LEAD_REVISION:
    'The CRM Lead changed. Refresh and review it before continuing.',
  QUALIFICATION_INCOMPLETE:
    'Keep this record as a Lead until a human verifies all four qualification areas.',
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
  const [onlyUnsubscribed, setOnlyUnsubscribed] = useState(false)
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
  const [recipientProperties, setRecipientProperties] = useState<Record<string, string>>({})
  const [recipientEvidence, setRecipientEvidence] = useState<Record<string, string>>({})
  const [recipientEvidenceSources, setRecipientEvidenceSources] = useState<Record<string, 'import' | 'human_assessment'>>({})
  const [recipientRelationships, setRecipientRelationships] = useState<Record<string, 'owner' | 'representative' | 'heir' | 'relative'>>({})
  const [samplePeople, setSamplePeople] = useState<Record<string, string>>({})
  const [sampleSenders, setSampleSenders] = useState<Record<string, string>>({})
  const [showSimulation, setShowSimulation] = useState(false)
  const [simulationBody, setSimulationBody] = useState(
    'I might consider selling. Call me at 816-555-0101. Tomorrow afternoon works.',
  )

  const requestSequence = useRef(0)
  const sampleKeys = useRef<Record<string, string>>({})
  const refresh = useCallback(async () => {
    const request = ++requestSequence.current
    const response = await fetch('/api/email/workspace', { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error?.code ?? body.error)
    if (request === requestSequence.current) setData(body)
    return body as PilotState
  }, [])
  useEffect(() => {
    let cancelled = false
    const target = new URLSearchParams(window.location.search).get('thread')
    if (target && /^[0-9a-f-]{36}$/i.test(target)) {
      setThreadId(target)
      setMine(false)
      setView('all')
    }
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

  useEffect(() => {
    if (busy || loading) return
    let active = true
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      refresh().catch((e) => {
        if (active)
          setError(
            friendly[e.message] ??
              'Email refresh failed. Your saved work is unchanged.',
          )
      })
    }, 30000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [busy, loading, refresh])

  async function act(command: EmailCommand) {
    ++requestSequence.current
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
            settings_saved: 'Setup details saved. Sending remains disabled.',
            roles_saved: 'Team access updated.',
            work_held:
              'Access updated. Affected work is held for owner review.',
            draft: 'Draft updated.',
            simulation_active:
              'Practice campaign started. Delivery is simulated.',
            human: 'You control this conversation.',
            test_callback_reviewed: 'Callback test complete. Moved to Done.',
            draft_saved: 'Reply draft saved.',
            queued_simulation: 'Reply queued for simulated delivery.',
            marketing_stopped:
              'Marketing stopped across campaigns and confirmed aliases.',
            handoff_saved_calendar_not_connected:
              'Local callback handoff saved. CRM linking and calendar booking were not run.',
            handoff_saved_crm_synced:
              'Handoff saved. The Lead and callback review task are linked in CRM. No appointment was booked.',
            handoff_saved_crm_review:
              'Handoff saved. CRM review is required before CRM can finish linking the record or create the callback task.',
            handoff_saved_crm_dependency_blocked:
              'Handoff saved in Email. CRM linking is unavailable and no callback task was created.',
            acknowledged: 'Notification acknowledged.',
            note_saved: 'Note saved to the CRM record.',
            task_created:
              'Task saved to Upcoming. The assignee has an in-app alert.',
            appointment_task_created:
              'CRM appointment saved to Upcoming. No Google Calendar event or invitation was created.',
            reply_retry_queued:
              'Reply retrieval queued again. Follow-ups stay held until the full message is verified.',
            callback_scheduled:
              'Follow-up task saved. No calendar invitation was sent.',
            callback_completed:
              'Callback completed. The record remains at its current CRM stage.',
            callback_not_fit:
              'Email callback closed as not a fit. The CRM stage stays unchanged.',
            callback_accepted: 'Callback accepted.',
            ai_ready: 'Ari’s suggestion is ready for review.',
            ai_running: 'Ari is already preparing this reply.',
            ai_queued: 'Ari’s draft request is saved.',
            ai_failed: 'Ari could not finish. No reply was queued.',
            ai_stale:
              'The conversation changed while Ari was working. The saved result cannot be approved.',
            callback_reassigned:
              'Lead and callback assigned. The new owner has an acceptance notification.',
            conversation_done: 'Conversation marked done.',
            crm_repair_resolved:
              'CRM history and callback updates are current.',
            crm_repair_pending:
              'CRM still needs repair. The pending update is saved, and marketing restrictions remain in effect.',
            paused: 'Sending paused.',
            recipient_identity_confirmed:
              'Person, mailbox and property confirmed. Campaign eligibility was recalculated.',
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

  async function sendCampaignSample(campaign: PilotState['campaigns'][number]) {
    const senderId = sampleSenders[campaign.id] ?? campaign.draft_config.senderIds?.[0]
    if (!senderId) {
      setError('Choose and save a tested sender before sending a sample.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    const sampleKey = [campaign.id, campaign.revision, senderId, samplePeople[campaign.id] ?? 'literal'].join(':')
    sampleKeys.current[sampleKey] ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/email/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_test',
          senderId,
          campaignId: campaign.id,
          samplePartyId: samplePeople[campaign.id] || undefined,
          idempotencyKey: sampleKeys.current[sampleKey],
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.code ?? body.error)
      if (body.delivery?.state !== 'accepted')
        throw new Error('SAMPLE_DELIVERY_NOT_ACCEPTED')
      setNotice(`${body.delivery?.alreadySent ? 'This sample was already sent' : 'Sample sent'} to ${body.recipient}. No follow-up was scheduled.`)
      await refresh()
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
      (!onlyUnsubscribed || t.outcome === 'unsubscribed') &&
      `${t.name} ${t.email} ${t.subject} ${data?.messages
        .filter((m) => m.thread_id === t.id)
        .map((m) => m.text_body)
        .join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  const visible = scoped.filter((t) => matchesView(t, view, data?.asOf))
  const selected = scoped.find((t) => t.id === threadId)
  const canManage = data?.roles.some((r) => ['owner', 'marketer'].includes(r))
  const campaignChoices = Array.from(
    new Map(
      (data?.threads ?? []).map((t) => [t.campaign_id, t.campaign_name]),
    ).entries(),
  )

  function selectThread(thread: PilotThread) {
    setThreadId(thread.id)
  }
  function selectCampaign(id: string) {
    const selected = data?.campaigns.find((c) => c.id === id)
    setCampaignId(id)
    setConfig(
      selected?.draft_config.steps
        ? (selected.draft_config as PilotConfig)
        : pilotDefaults(data?.audiences[0]?.id ?? '', data),
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
      setConfig(pilotDefaults(data?.audiences[0]?.id ?? '', data))
      setCampaignTab('Sequence')
      setReview(null)
      setNewName('')
    }
  }

  return (
    <main className={styles.workspace} data-mode={data?.mode}>
      <header className={styles.header}>
        <h1>Email</h1>
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
        <div className={styles.headerRight}>
          {data && (
            <EmailNotifications
              data={data}
              busy={busy}
              act={act}
              openThread={(id) => {
                setSection('inbox')
                setView('all')
                setMine(false)
                setOnlyUnsubscribed(false)
                setSearch('')
                setCampaignFilter('')
                setThreadId(id)
              }}
            />
          )}
          <span className={styles.mode}>
            {data?.paused ? 'Paused' : data?.sendingEnabled ? 'Sending enabled' : 'Live sending off'}
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
      {data?.mode !== 'hosted' && <div className={styles.banner}>
        <strong>
          {data?.mode === 'simulation'
            ? 'Local practice workspace'
            : 'Email setup pending'}
        </strong>
        <span>
          {data?.mode === 'simulation'
            ? 'Practice only · No messages, calls or calendar events are sent.'
            : 'Your team will work here once the remaining integrations are connected and verified.'}
        </span>
        {data && (
          <small className={styles.asOf}>As of {formatTime(data.asOf)}</small>
        )}
      </div>}
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
                      {
                        scoped.filter((t) => matchesView(t, key, data.asOf))
                          .length
                      }
                    </span>
                  </button>
                ))}
              </div>
              <label className={styles.restrictionFilter}>
                <input
                  type="checkbox"
                  checked={onlyUnsubscribed}
                  onChange={(e) => setOnlyUnsubscribed(e.target.checked)}
                />{' '}
                Unsubscribed only
              </label>
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
                        <small>{nextWork(t, data.asOf)}</small>
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
                {selected ? (
                  <EmailThreadPanel
                    onBackToInbox={() => { setThreadId(null); setView('action') }}
                    key={selected.id}
                    data={data}
                    thread={selected}
                    act={act}
                    busy={busy}
                    localSimulation={localSimulation}
                  />
                ) : (
                  <section className={styles.empty}>
                    <h3>Select a conversation</h3>
                    <p>The latest reply and next action appear here.</p>
                  </section>
                )}
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
                        <span>{c.is_test ? 'Setup test · report separately' : c.state}</span>
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
                              : (data.mode === 'hosted' ? 'Published campaign version' : 'Frozen published version · simulated transport')}
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
                            A bounce, complaint or provider suppression pauses the pilot for review. Cancelled emails do not restart automatically.
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
                          {data.mode === 'hosted' && <label>Sender<select disabled={campaign.state !== 'draft'} value={config.senderIds[0] ?? ''} onChange={e => {setConfig({...config,senderIds:[e.target.value]});setReview(null)}}><option value="">Choose a sender</option>{(data.sampleSenders ?? []).map(s => <option key={s.id} value={s.id}>{s.name} · {s.address}{s.state === 'paused' ? ' · test pending' : ''}</option>)}</select></label>}
                          {campaign.state === 'draft' && <div>
                            <button onClick={() => { setConfig(inheritedPropertyCopy(config)); setReview(null) }}>Use inherited-property sequence</button>
                            <p>Verified fields: {'{{first_name}}'}, {'{{property_address}}'}, {'{{property_question}}'}. Family wording requires a confirmed heir relationship. Missing or ambiguous facts block sending. Save, then review each person’s exact messages.</p>
                          </div>}
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
                                            ? (data.mode === 'hosted' ? 'Eligible for reviewed campaign' : 'Ready for local practice')
                                            : r.reasons.map(reason => friendly[reason] ?? reason).join(' · ')}
                                        </small>
                                        {r.messages && <details><summary>Preview this person’s emails</summary>{r.messages.map((message, index) => <article key={index}><h4>{message.subject}</h4><pre>{message.body}</pre></article>)}</details>}
                                        {!r.eligible && (r.reasons.includes('Identity needs review') || r.reasons.includes('PERSONALIZATION_PROPERTY_REQUIRED')) && (
                                          <div>
                                            <label>
                                              Property address for this person
                                              <input
                                                value={recipientProperties[r.id] ?? ''}
                                                placeholder="Street address, city"
                                                onChange={(event) =>
                                                  setRecipientProperties((current) => ({
                                                    ...current,
                                                    [r.id]: event.target.value,
                                                  }))
                                                }
                                              />
                                            </label>
                                            <label>Relationship supported by evidence<select value={recipientRelationships[r.id] ?? 'relative'} onChange={event => setRecipientRelationships(current => ({ ...current, [r.id]: event.target.value as 'owner' | 'representative' | 'heir' | 'relative' }))}><option value="representative">Confirmed representative</option><option value="relative">Source-reported relative (authority unconfirmed)</option><option value="owner">Owner</option><option value="heir">Confirmed heir</option></select></label>
                                            <label>Evidence source<select value={recipientEvidenceSources[r.id] ?? 'import'} onChange={event => setRecipientEvidenceSources(current => ({ ...current, [r.id]: event.target.value as 'import' | 'human_assessment' }))}><option value="import">Reviewed source records</option><option value="human_assessment">Direct human confirmation</option></select></label>
                                            <label>Evidence for this person, email and property<textarea value={recipientEvidence[r.id] ?? ''} placeholder="Source and facts you checked; do not infer an heir from a shared last name." onChange={event => setRecipientEvidence(current => ({ ...current, [r.id]: event.target.value }))}/></label>
                                            <button
                                              disabled={busy || !(recipientProperties[r.id]?.trim()) || !(recipientEvidence[r.id]?.trim())}
                                              onClick={async () => {
                                                const saved = await act({
                                                  command: 'AUD-RESOLVE',
                                                  idempotencyKey: crypto.randomUUID(),
                                                  payload: {
                                                    rowId: r.id,
                                                    partyId: r.partyId,
                                                    propertyRef: recipientProperties[r.id].trim(),
                                                    resolution: 'link_existing',
                                                    relationship: recipientRelationships[r.id] ?? 'relative',
                                                    evidence: [
                                                      {
                                                        source: recipientEvidenceSources[r.id] ?? 'import',
                                                        quote: recipientEvidence[r.id].trim(),
                                                      },
                                                    ],
                                                  },
                                                })
                                                if (saved) await fetchReview(campaign.id)
                                              }}
                                            >
                                              Confirm person + property
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <details>
                                    <summary>
                                      Saved sequence and shared signature
                                    </summary>
                                    {campaign.draft_config.steps?.map((s) => (
                                      <article key={s.id}>
                                        <h4>{s.subject}</h4>
                                        <pre>{s.bodyTemplate}</pre>
                                      </article>
                                    ))}
                                    {data.settings?.config.business && <article><h4>Included with every email</h4><pre>{outreachFooter(data.settings.config.business.name, data.settings.config.business.address, '[Personal unsubscribe link]')}</pre><small>The actual message includes a clickable Unsubscribe link. Personalized message text is shown under each reviewed recipient.</small></article>}
                                  </details>
                                  {data.mode === 'hosted' && (
                                    <div>
                                      {campaign.draft_config.steps?.some(step => (step.subject + step.bodyTemplate).includes('{{')) && <label>Sample recipient’s verified details<select value={samplePeople[campaign.id] ?? ''} onChange={event => setSamplePeople(current => ({ ...current, [campaign.id]: event.target.value }))}><option value="">Choose a reviewed recipient</option>{review.recipients.filter(r => r.eligible && r.messages).map(r => <option key={r.id} value={r.partyId}>{r.name}</option>)}</select><small>The sample goes only to the configured test inbox. It uses this person’s reviewed copy.</small></label>}
                                      <label>
                                        Sample sender
                                        <select
                                          value={sampleSenders[campaign.id] ?? campaign.draft_config.senderIds?.[0] ?? ''}
                                          onChange={(event) => setSampleSenders((current) => ({ ...current, [campaign.id]: event.target.value }))}
                                        >
                                          {(data.sampleSenders ?? []).map((sender) => (
                                            <option key={sender.id} value={sender.id}>
                                              {sender.name} · {sender.address}{sender.state === 'paused' ? ' · test pending' : ''}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <button
                                        disabled={busy || (campaign.draft_config.steps?.some(step => (step.subject + step.bodyTemplate).includes('{{')) && !samplePeople[campaign.id])}
                                        onClick={() => sendCampaignSample(campaign)}
                                      >
                                        Send exact sample
                                      </button>
                                    </div>
                                  )}
                                  {!!review.blockers?.length && <div role="status"><strong>Before starting</strong><ul>{review.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>}
                                  <button
                                    className={styles.primary}
                                    disabled={
                                      busy ||
                                      !!review.blockers?.length ||
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
                                    {data.mode === 'hosted' ? 'Start reviewed campaign' : 'Start reviewed simulation'}
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
              <details className={styles.operations}>
                <summary>Ari’s reply rules</summary>
                <p>
                  Human approval is required. Use everyday language, supported
                  facts and one useful question. Don’t invent pain or infer
                  selling intent from an email open.
                </p>
                <p>
                  {data.ai_available
                    ? 'AI credentials are available; individual draft results show whether the provider completed the request.'
                    : 'AI access is not configured. You can write and review drafts manually.'}
                </p>
              </details>
              {data.settings && data.mode === 'hosted' && <EmailHostedSetup onChange={refresh} revision={data.settings.revision} />}
              {data.settings && data.mode === 'hosted' && <EmailRecipientImport onImported={refresh} />}
              {data.settings && (
                <EmailSetup settings={data.settings} busy={busy} act={act} />
              )}
              {data.roles.some((r) =>
                ['owner', 'marketer', 'reviewer', 'acquisitions'].includes(r),
              ) && (
                <section className={styles.operations}>
                  <h3>Operations</h3>
                  {data.roles.includes('owner') && (
                    <EmailReceivingStatus
                      localSimulation={localSimulation}
                      act={act}
                      onProcessed={refresh}
                    />
                  )}
                  {data.paused && data.pauseReason && (
                    <p role="status">Paused: {data.pauseReason}</p>
                  )}
                  <p>
                    Sending follows the workspace controls and campaign limits.
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
