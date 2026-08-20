'use client'

import { useRef, useLayoutEffect, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { MessageBubble, type Message } from './message-bubble'
import { ComposeBox } from './compose-box'
import { cn } from '@/lib/utils'

interface ThreadContact {
  name: string
  initials: string
  verified?: boolean
  assignedAgent?: string | null
  team: string
  replyFromPhone?: string
  attentionState: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  owner: string | null
  nextAction: {
    id: string
    title: string
    dueAt: string | null
    owner: string | null
    overdue: boolean
  } | null
}

interface DateGroup {
  label: string
  messages: Message[]
}

const CONVERSATION_AGENTS = ['Ernest', 'Casey', 'Gertha'] as const
type ConversationAgent = (typeof CONVERSATION_AGENTS)[number]

export function ThreadView({
  contact,
  dateGroups,
  threadKey,
  leadId,
  phone,
  email,
  onCall,
  onBack,
  onSent,
  onConversationChanged,
  contactDetailsOpen = true,
  onToggleContactDetails,
  initialComposeMode = 'sms',
  timelineLoading = false,
  timelineError = null,
  hasEarlierActivity = false,
  loadingEarlierActivity = false,
  onRetryTimeline,
  onLoadEarlierActivity,
  degradedWarning = null,
}: {
  contact: ThreadContact
  dateGroups: DateGroup[]
  threadKey: string
  leadId?: string
  phone?: string
  email?: string
  onCall?: () => void
  onBack?: () => void
  onSent?: () => void
  onConversationChanged?: () => void
  contactDetailsOpen?: boolean
  onToggleContactDetails?: () => void
  initialComposeMode?: 'sms' | 'email' | 'note'
  timelineLoading?: boolean
  timelineError?: string | null
  hasEarlierActivity?: boolean
  loadingEarlierActivity?: boolean
  onRetryTimeline?: () => void
  onLoadEarlierActivity?: () => void
  degradedWarning?: string | null
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousTimelineEnd = useRef<string | null>(null)
  const preserveScrollHeight = useRef<number | null>(null)
  const [completingTask, setCompletingTask] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [assigningAgent, setAssigningAgent] = useState(false)
  const [updatingThread, setUpdatingThread] = useState(false)

  useLayoutEffect(() => {
    const timeline = scrollRef.current
    if (!timeline) return
    if (preserveScrollHeight.current !== null) {
      timeline.scrollTop += timeline.scrollHeight - preserveScrollHeight.current
      preserveScrollHeight.current = null
      return
    }

    const latestMessage = dateGroups.at(-1)?.messages.at(-1)?.id ?? null
    const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 160
    if (previousTimelineEnd.current === null || nearBottom) timeline.scrollTop = timeline.scrollHeight
    previousTimelineEnd.current = latestMessage
  }, [dateGroups])

  function loadEarlierActivity() {
    if (!onLoadEarlierActivity || loadingEarlierActivity) return
    preserveScrollHeight.current = scrollRef.current?.scrollHeight ?? null
    onLoadEarlierActivity()
  }

  async function completePrimaryAction() {
    if (!contact.nextAction || completingTask) return
    setCompletingTask(true)
    setTaskError(null)
    try {
      const response = await fetch(`/api/leads/tasks/${contact.nextAction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (!response.ok) {
        const payload = await response.json() as { error?: string }
        throw new Error(payload.error || 'Unable to complete the action')
      }
      setMenuOpen(false)
      onConversationChanged?.()
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to complete the action')
    } finally {
      setCompletingTask(false)
    }
  }

  async function updateThreadState(action: 'mark_read' | 'mark_unread') {
    if (!threadKey || updatingThread) return
    setUpdatingThread(true)
    setTaskError(null)
    try {
      const response = await fetch('/api/conversations/thread-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          threadKey,
          leadId: leadId?.startsWith('unmatched:') ? null : leadId,
          phone,
          source: 'conversation_hub',
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to update the conversation')
      setMenuOpen(false)
      onConversationChanged?.()
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to update the conversation')
    } finally {
      setUpdatingThread(false)
    }
  }

  async function assignAgent(assignedAgent: ConversationAgent | null) {
    if (!leadId || leadId.startsWith('unmatched:') || assigningAgent) return
    setAssigningAgent(true)
    setTaskError(null)
    try {
      const response = await fetch('/api/conversations/assignment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, assignedAgent }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Unable to assign the conversation')
      setAgentMenuOpen(false)
      setMenuOpen(false)
      onConversationChanged?.()
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to assign the conversation')
    } finally {
      setAssigningAgent(false)
    }
  }

  const attentionLabel = contact.attentionState === 'needs_reply'
    ? 'Needs Reply'
    : contact.attentionState === 'waiting_on_contact'
      ? 'Waiting on contact'
      : 'Resolved'
  const attentionIcon = contact.attentionState === 'needs_reply'
    ? 'mark_chat_unread'
    : contact.attentionState === 'waiting_on_contact'
      ? 'hourglass_top'
      : 'check_circle'
  const attentionClasses = contact.attentionState === 'needs_reply'
    ? 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
    : contact.attentionState === 'waiting_on_contact'
      ? 'border-[var(--crm-violet)]/30 bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]'
      : 'border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] text-[var(--crm-success)]'

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--crm-canvas)]">
      {/* Thread Header */}
      <header className="flex h-[64px] flex-shrink-0 items-center justify-between border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 md:h-[76px] md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? <button type="button" onClick={onBack} aria-label="Back to conversation inbox" className="crm-icon-button grid h-9 w-9 shrink-0 place-items-center rounded-lg md:hidden"><Icon name="arrow_back" /></button> : null}
          <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-sm font-bold text-[var(--crm-surface)] md:flex">
            {contact.initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-bold text-[var(--crm-ink)] md:text-[17px]">
                {contact.name}
              </h2>
              {contact.verified && (
                <Icon name="verified" className="text-secondary text-lg" filled />
              )}
            </div>
            <p className="mt-0.5 truncate text-[10px] font-bold text-[var(--crm-text-muted)] md:hidden">{attentionLabel} · {contact.owner || contact.assignedAgent || 'Unassigned'}</p>
            <div className="mt-1 hidden min-w-0 flex-wrap items-center gap-2 md:flex">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAgentMenuOpen((value) => !value)}
                  disabled={!leadId || leadId.startsWith('unmatched:') || assigningAgent}
                  aria-expanded={agentMenuOpen}
                  aria-label={`Assign agent. Current: ${contact.assignedAgent || contact.owner || 'Unassigned'}`}
                  title={!leadId || leadId.startsWith('unmatched:') ? 'Create a contact before assigning an agent' : 'Assign agent'}
                  className="flex items-center gap-1 rounded-full border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-2 py-1 text-[10px] font-bold text-[var(--crm-text-muted)] transition-colors hover:border-[var(--crm-info)]/40 hover:bg-[var(--crm-info-soft)] hover:text-[var(--crm-info)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Icon name="person" className="text-[13px]" />
                  Agent · {assigningAgent ? 'Saving…' : contact.assignedAgent || contact.owner || 'Unassigned'}
                  <Icon name="expand_more" className="text-[12px]" />
                </button>
                {agentMenuOpen ? (
                  <div className="crm-menu absolute left-0 top-8 z-50 w-40 overflow-hidden rounded-xl py-1 shadow-xl">
                    {CONVERSATION_AGENTS.map((agent) => (
                      <button key={agent} type="button" onClick={() => void assignAgent(agent)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold hover:bg-[var(--crm-surface-subtle)]">
                        <span>Assign to {agent}</span>
                        {(contact.assignedAgent || contact.owner) === agent ? <Icon name="check" className="text-[15px] text-[var(--crm-success)]" /> : null}
                      </button>
                    ))}
                    <button type="button" onClick={() => void assignAgent(null)} className="flex w-full items-center justify-between border-t border-[var(--crm-border)] px-3 py-2 text-left text-xs font-semibold hover:bg-[var(--crm-surface-subtle)]">
                      <span>Return to team</span>
                      {!contact.assignedAgent && !contact.owner ? <Icon name="check" className="text-[15px] text-[var(--crm-success)]" /> : null}
                    </button>
                  </div>
                ) : null}
              </div>
              <span className="flex items-center gap-1 rounded-full border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-2 py-1 text-[10px] font-bold text-[var(--crm-text-muted)]">
                <Icon name="groups" className="text-[13px]" />
                Team · {contact.team}
              </span>
              <span className={cn('flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black', attentionClasses)}>
                <Icon name={attentionIcon} className="text-[13px]" />
                {attentionLabel}
              </span>
            </div>
          </div>
        </div>
        <div className="relative flex shrink-0 items-center gap-2">
          <button type="button" onClick={onCall} disabled={!phone} aria-label="Call contact" className="flex h-9 w-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] text-xs font-bold text-[var(--crm-success)] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 md:w-auto md:px-3"><Icon name="call" className="text-[17px]" /><span className="hidden md:inline">Call</span></button>
          {leadId && !leadId.startsWith('unmatched:') ? <Link href={`/leads/${leadId}`} prefetch={false} aria-label="Open full contact workspace" title="Open full contact workspace" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="open_in_new" className="text-[18px]" /></Link> : null}
          {onToggleContactDetails ? (
            <button
              type="button"
              onClick={onToggleContactDetails}
              aria-pressed={contactDetailsOpen}
              aria-label={contactDetailsOpen ? 'Hide contact details' : 'Show contact details'}
              className="crm-icon-button hidden h-9 w-9 items-center justify-center rounded-lg 2xl:flex"
            >
              <Icon name="dock_to_right" className="text-[18px]" />
            </button>
          ) : null}
          <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="Conversation actions" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg">
            <Icon name="more_vert" className="text-on-surface-variant" />
          </button>
          {menuOpen ? (
            <div className="crm-menu absolute right-0 top-11 z-40 w-48 overflow-hidden rounded-xl py-1">
              <button type="button" disabled={updatingThread} onClick={() => void updateThreadState(contact.attentionState === 'needs_reply' ? 'mark_read' : 'mark_unread')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-[var(--crm-surface-subtle)] disabled:opacity-50">
                <Icon name={contact.attentionState === 'needs_reply' ? 'mark_email_read' : 'mark_email_unread'} className="text-[17px]" />
                {contact.attentionState === 'needs_reply' ? 'Mark resolved' : 'Mark needs reply'}
              </button>
              {contact.nextAction ? <button type="button" disabled={completingTask} onClick={() => void completePrimaryAction()} className="flex w-full items-center gap-2 border-t border-[var(--crm-border)] px-3 py-2 text-left text-xs font-semibold hover:bg-[var(--crm-surface-subtle)] disabled:opacity-50 md:hidden"><Icon name="task_alt" className="text-[17px]" />{completingTask ? 'Completing action…' : 'Complete next action'}</button> : null}
              <div className="border-t border-[var(--crm-border)] py-1 md:hidden">
                <p className="px-3 pb-1 pt-2 text-[9px] font-black uppercase tracking-wide text-[var(--crm-text-muted)]">Assign owner</p>
                {CONVERSATION_AGENTS.map((agent) => (
                  <button key={agent} type="button" disabled={!leadId || leadId.startsWith('unmatched:') || assigningAgent} onClick={() => void assignAgent(agent)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold hover:bg-[var(--crm-surface-subtle)] disabled:opacity-50">
                    <span>Assign to {agent}</span>
                    {(contact.assignedAgent || contact.owner) === agent ? <Icon name="check" className="text-[15px] text-[var(--crm-success)]" /> : null}
                  </button>
                ))}
                <button type="button" disabled={!leadId || leadId.startsWith('unmatched:') || assigningAgent} onClick={() => void assignAgent(null)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold hover:bg-[var(--crm-surface-subtle)] disabled:opacity-50"><span>Return to team</span>{!contact.assignedAgent && !contact.owner ? <Icon name="check" className="text-[15px] text-[var(--crm-success)]" /> : null}</button>
              </div>
              {leadId && !leadId.startsWith('unmatched:') ? <Link href={`/leads/${leadId}`} prefetch={false} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-[var(--crm-surface-subtle)]"><Icon name="person" className="text-[17px]" />Open contact</Link> : null}
            </div>
          ) : null}
        </div>
      </header>

      {degradedWarning ? (
        <div role="alert" className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-[var(--crm-warning)]/35 bg-[var(--crm-warning-soft)] px-3 py-2 text-xs font-semibold text-[var(--crm-text)] md:mx-5 md:mt-3">
          <Icon name="warning_amber" className="mt-0.5 shrink-0 text-[var(--crm-warning)]" />
          <span><strong>Compatibility timeline.</strong> {degradedWarning}</span>
        </div>
      ) : null}

      {taskError ? (
        <div role="alert" className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--crm-danger)] md:mx-5 md:mt-3">
          <Icon name="error" className="mt-0.5 shrink-0" />
          <span>{taskError}</span>
        </div>
      ) : null}

      {(contact.attentionState !== 'resolved' || contact.nextAction) && (
        <div className={cn(
          'mx-3 mt-2 flex items-center justify-between gap-2 rounded-xl border-l-4 px-3 py-2 md:mx-5 md:mt-3 md:flex-wrap md:gap-3 md:px-4 md:py-3',
          contact.attentionState === 'needs_reply'
            ? 'border border-[var(--crm-brand-border)] border-l-[var(--crm-brand)] bg-[var(--crm-brand-soft)]'
            : contact.attentionState === 'waiting_on_contact'
              ? 'border border-[var(--crm-violet)]/30 border-l-[var(--crm-violet)] bg-[var(--crm-violet-soft)]'
              : 'border border-[var(--crm-success)]/30 border-l-[var(--crm-success)] bg-[var(--crm-success-soft)]',
        )}>
          <div className="flex items-center gap-3">
            <span className={
              contact.attentionState === 'needs_reply'
                ? 'rounded-full bg-[var(--crm-brand)] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white'
                : contact.attentionState === 'waiting_on_contact'
                  ? 'rounded-full bg-[var(--crm-violet)] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white'
                  : 'rounded-full bg-[var(--crm-success)] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white'
            }>
              {attentionLabel}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">
                {contact.nextAction?.title || 'Review this conversation'}
              </p>
              <p className="text-xs text-slate-500">
                Owner: {contact.nextAction?.owner || contact.owner || 'Unassigned'}
                {contact.nextAction?.dueAt
                  ? ` · Due ${new Date(contact.nextAction.dueAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                  : ''}
              </p>
            </div>
          </div>
          {contact.nextAction?.overdue && (
            <span className="hidden text-xs font-black uppercase tracking-wide text-red-700 md:inline">Overdue</span>
          )}
          {contact.nextAction && (
            <button
              type="button"
              onClick={completePrimaryAction}
              disabled={completingTask}
              className="crm-secondary-button hidden rounded-lg px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60 md:block"
            >
              {completingTask ? 'Completing…' : 'Mark complete'}
            </button>
          )}
        </div>
      )}

      {/* Authoritative timeline */}
      <div ref={scrollRef} aria-busy={timelineLoading || loadingEarlierActivity} className="flex-1 space-y-3 overflow-y-auto bg-[var(--crm-canvas)] px-3 py-3 scroll-smooth md:space-y-6 md:px-6 md:py-5">
        {timelineLoading ? (
          <div role="status" aria-label="Loading conversation timeline" className="grid min-h-48 place-items-center text-sm font-bold text-[var(--crm-text-muted)]">
            <span className="flex items-center gap-2"><Icon name="progress_activity" className="animate-spin" /> Loading activity…</span>
          </div>
        ) : timelineError ? (
          <div role="alert" className="mx-auto mt-8 max-w-md rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] p-5 text-center">
            <p className="text-sm font-black text-[var(--crm-ink)]">Timeline could not be loaded</p>
            <p className="mt-1 text-xs font-medium text-[var(--crm-text-muted)]">{timelineError}</p>
            {onRetryTimeline ? <button type="button" onClick={onRetryTimeline} className="crm-secondary-button mt-3 rounded-lg px-3 py-2 text-xs font-black">Retry timeline</button> : null}
          </div>
        ) : dateGroups.every((group) => group.messages.length === 0) ? (
          <div role="status" className="grid min-h-48 place-items-center text-center">
            <div><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]"><Icon name="forum" /></span><p className="mt-3 text-sm font-black text-[var(--crm-ink)]">No activity yet</p><p className="mt-1 text-xs font-medium text-[var(--crm-text-muted)]">Start the first message or add an internal note below.</p></div>
          </div>
        ) : (
          <>
            {hasEarlierActivity && onLoadEarlierActivity ? (
              <div className="flex justify-center pb-1">
                <button type="button" onClick={loadEarlierActivity} disabled={loadingEarlierActivity} className="crm-secondary-button flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-black disabled:opacity-60">
                  <Icon name={loadingEarlierActivity ? 'progress_activity' : 'history'} className={loadingEarlierActivity ? 'animate-spin' : ''} />
                  {loadingEarlierActivity ? 'Loading…' : 'Load earlier activity'}
                </button>
              </div>
            ) : null}
            {dateGroups.map((group) => (
              <div key={group.label} className="space-y-5">
                <div className="flex items-center gap-4">
                  <div className="h-px flex-1 bg-outline-variant/20" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">{group.label}</span>
                  <div className="h-px flex-1 bg-outline-variant/20" />
                </div>
                {group.messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Compose Box — reply from the same number the lead texted */}
      <ComposeBox
        key={initialComposeMode}
        leadId={leadId}
        phone={phone}
        email={email}
        onSent={onSent}
        replyFromPhone={contact.replyFromPhone}
        initialMode={initialComposeMode}
      />
    </section>
  )
}
