'use client'

import { useRef, useEffect, useState } from 'react'
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
  leadId,
  phone,
  email,
  onCall,
  onSent,
  onConversationChanged,
  contactDetailsOpen = true,
  onToggleContactDetails,
  initialComposeMode = 'sms',
}: {
  contact: ThreadContact
  dateGroups: DateGroup[]
  leadId?: string
  phone?: string
  email?: string
  onCall?: () => void
  onSent?: () => void
  onConversationChanged?: () => void
  contactDetailsOpen?: boolean
  onToggleContactDetails?: () => void
  initialComposeMode?: 'sms' | 'email' | 'note'
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [completingTask, setCompletingTask] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [assigningAgent, setAssigningAgent] = useState(false)
  const [updatingThread, setUpdatingThread] = useState(false)
  const [quickDraft, setQuickDraft] = useState('')
  const [quickDraftVersion, setQuickDraftVersion] = useState(0)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [dateGroups])

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
      onConversationChanged?.()
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to complete the action')
    } finally {
      setCompletingTask(false)
    }
  }

  async function updateThreadState(action: 'mark_read' | 'mark_unread') {
    if ((!leadId && !phone) || updatingThread) return
    setUpdatingThread(true)
    setTaskError(null)
    try {
      const response = await fetch('/api/conversations/thread-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          leadId: leadId?.startsWith('unmatched:') ? null : leadId,
          phone,
          agent: 'Ernest',
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
      onConversationChanged?.()
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to assign the conversation')
    } finally {
      setAssigningAgent(false)
    }
  }

  function applyQuickReply(reply: string) {
    setQuickDraft(reply)
    setQuickDraftVersion((value) => value + 1)
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
      <header className="hidden h-[76px] flex-shrink-0 items-center justify-between border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-5 md:flex">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-sm font-bold text-[var(--crm-surface)]">
            {contact.initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[17px] font-bold text-[var(--crm-ink)]">
                {contact.name}
              </h2>
              {contact.verified && (
                <Icon name="verified" className="text-secondary text-lg" filled />
              )}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
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
          <button type="button" onClick={onCall} disabled={!phone} className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] px-3 text-xs font-bold text-[var(--crm-success)] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="call" className="text-[17px]" /> Call</button>
          {leadId && !leadId.startsWith('unmatched:') ? <Link href={`/leads/${leadId}`} prefetch={false} aria-label="Open full contact workspace" title="Open full contact workspace" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="open_in_new" className="text-[18px]" /></Link> : null}
          {onToggleContactDetails ? (
            <button
              type="button"
              onClick={onToggleContactDetails}
              aria-pressed={contactDetailsOpen}
              aria-label={contactDetailsOpen ? 'Hide contact details' : 'Show contact details'}
              className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"
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
              {leadId && !leadId.startsWith('unmatched:') ? <Link href={`/leads/${leadId}`} prefetch={false} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-[var(--crm-surface-subtle)]"><Icon name="person" className="text-[17px]" />Open contact</Link> : null}
            </div>
          ) : null}
        </div>
      </header>

      {(contact.attentionState !== 'resolved' || contact.nextAction) && (
        <div className={cn(
          'mx-3 mt-2 flex items-center justify-between gap-2 rounded-xl border-l-4 px-3 py-2 md:mx-5 md:mt-3 md:flex-wrap md:gap-3 md:px-4 md:py-3',
          contact.attentionState === 'needs_reply'
            ? 'border border-[var(--crm-brand-border)] border-l-[var(--crm-brand)] bg-[var(--crm-brand-soft)]'
            : 'border border-[var(--crm-violet)]/30 border-l-[var(--crm-violet)] bg-[var(--crm-violet-soft)]',
        )}>
          <div className="flex items-center gap-3">
            <span className={
              contact.attentionState === 'needs_reply'
                ? 'rounded-full bg-[var(--crm-brand)] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white'
                : 'rounded-full bg-[var(--crm-violet)] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white'
            }>
              {contact.attentionState === 'needs_reply' ? 'Needs Reply' : 'Waiting on contact'}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">
                {contact.nextAction?.title || 'Review this conversation'}
              </p>
              <p className="hidden text-xs text-slate-500 md:block">
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
          {taskError && <p className="w-full text-xs font-medium text-red-700">{taskError}</p>}
        </div>
      )}

      {/* Chat Content */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-[var(--crm-canvas)] px-3 py-3 scroll-smooth md:space-y-6 md:px-6 md:py-5">
        {dateGroups.map((group) => (
          <div key={group.label} className="space-y-5">
            {/* Date Divider */}
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-outline-variant/20" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">
                {group.label}
              </span>
              <div className="flex-1 h-px bg-outline-variant/20" />
            </div>

            {/* Messages */}
            {group.messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        ))}
      </div>

      <div className="hidden shrink-0 gap-2 border-t border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 pt-3 md:flex">
        {[
          { label: 'I can call at 2:30', tone: 'border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] text-[var(--crm-success)] hover:brightness-95' },
          { label: 'Send property details', tone: 'border-[var(--crm-border-strong)] bg-[var(--crm-info-soft)] text-[var(--crm-info)] hover:brightness-95' },
          { label: 'Book appointment', tone: 'border-[var(--crm-border-strong)] bg-[var(--crm-violet-soft)] text-[var(--crm-violet)] hover:brightness-95' },
        ].map((reply) => (
          <button
            key={reply.label}
            type="button"
            onClick={() => applyQuickReply(reply.label)}
            className={cn('rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors', reply.tone)}
          >
            {reply.label}
          </button>
        ))}
      </div>

      {/* Compose Box — reply from the same number the lead texted */}
      <ComposeBox
        key={`${quickDraftVersion}:${initialComposeMode}`}
        leadId={leadId}
        phone={phone}
        email={email}
        onSent={onSent}
        replyFromPhone={contact.replyFromPhone}
        draftMessage={quickDraft}
        initialMode={initialComposeMode}
      />
    </section>
  )
}
