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
  address: string
  county: string
  tags: string[]
  verified?: boolean
  assignedAgent?: string | null
  toPhone?: string
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

  function applyQuickReply(reply: string) {
    setQuickDraft(reply)
    setQuickDraftVersion((value) => value + 1)
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#fbfaf8_0%,#f5f2ed_100%)]">
      {/* Thread Header */}
      <header className="flex h-[76px] flex-shrink-0 items-center justify-between border-b border-t-[3px] border-b-[#e2ddd6] border-t-[#d92636] bg-[linear-gradient(90deg,#ffffff_0%,#fff8f6_100%)] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0a2138] text-sm font-black text-white">
            {contact.initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[17px] font-bold text-[#111827]">
                {contact.name}
              </h2>
              {contact.verified && (
                <Icon name="verified" className="text-secondary text-lg" filled />
              )}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-3">
              <span className="flex items-center gap-1 truncate text-xs font-medium text-slate-500"><Icon name="call" className="text-[14px]" />{contact.county}</span>
              <span className="flex items-center gap-1 truncate text-xs font-medium text-slate-500"><Icon name="home" className="text-[14px]" />{contact.address}</span>
              <div className="flex shrink-0 gap-2">
                {contact.tags.map((tag) => (
                  <span
                    key={tag}
                    className={
                      tag === 'Pre-foreclosure'
                        ? 'px-2 py-0.5 bg-tertiary-container text-on-tertiary-container text-[10px] font-bold rounded'
                        : 'px-2 py-0.5 bg-surface-container-highest text-on-surface-variant text-[10px] font-bold rounded'
                    }
                  >
                    {tag}
                  </span>
                ))}
                <span className="rounded border border-[#efb4b8] bg-[#fff7f7] px-2 py-0.5 text-[10px] font-bold text-[#b91c26]">{contact.attentionState === 'needs_reply' ? 'Needs reply' : 'Active'}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="relative flex shrink-0 items-center gap-2">
          <button type="button" onClick={onCall} disabled={!phone} className="flex h-9 items-center gap-1.5 rounded-md border border-[#8bc9bf] bg-[#e8f7f3] px-3 text-xs font-bold text-[#087f70] hover:bg-[#d9f1eb] disabled:cursor-not-allowed disabled:opacity-40"><Icon name="call" className="text-[17px]" /> Call</button>
          {leadId && !leadId.startsWith('unmatched:') ? <Link href={`/leads/${leadId}`} aria-label="Open full contact workspace" title="Open full contact workspace" className="flex h-9 w-9 items-center justify-center rounded-md border border-[#cfd5dc] bg-white hover:bg-[#fff7f7]"><Icon name="open_in_new" className="text-[18px]" /></Link> : null}
          {onToggleContactDetails ? (
            <button
              type="button"
              onClick={onToggleContactDetails}
              aria-pressed={contactDetailsOpen}
              aria-label={contactDetailsOpen ? 'Hide contact details' : 'Show contact details'}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-[#cfd5dc] bg-white text-[#344054] hover:bg-[#fff7f7] hover:text-[#b91c26]"
            >
              <Icon name="dock_to_right" className="text-[18px]" />
            </button>
          ) : null}
          <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="Conversation actions" className="flex h-9 w-9 items-center justify-center rounded-md border border-[#cfd5dc] bg-white hover:bg-[#fff7f7]">
            <Icon name="more_vert" className="text-on-surface-variant" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-11 z-40 w-48 overflow-hidden rounded-lg border border-[#d9dfe6] bg-white py-1 shadow-xl">
              <button type="button" disabled={updatingThread} onClick={() => void updateThreadState(contact.attentionState === 'needs_reply' ? 'mark_read' : 'mark_unread')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-[#344054] hover:bg-[#f7f8fa] disabled:opacity-50">
                <Icon name={contact.attentionState === 'needs_reply' ? 'mark_email_read' : 'mark_email_unread'} className="text-[17px]" />
                {contact.attentionState === 'needs_reply' ? 'Mark resolved' : 'Mark needs reply'}
              </button>
              {leadId && !leadId.startsWith('unmatched:') ? <Link href={`/leads/${leadId}`} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#344054] hover:bg-[#f7f8fa]"><Icon name="person" className="text-[17px]" />Open contact</Link> : null}
            </div>
          ) : null}
        </div>
      </header>

      {(contact.attentionState !== 'resolved' || contact.nextAction) && (
        <div className={cn(
          'mx-5 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border-l-4 px-4 py-3 shadow-[0_5px_16px_rgba(16,40,63,0.06)]',
          contact.attentionState === 'needs_reply'
            ? 'border border-[#f3b0b5] border-l-[#d92636] bg-[linear-gradient(90deg,#fff0f1,#fff9f7)]'
            : 'border border-[#efd59b] border-l-[#c77700] bg-[linear-gradient(90deg,#fff4d8,#fffbef)]',
        )}>
          <div className="flex items-center gap-3">
            <span className={
              contact.attentionState === 'needs_reply'
                ? 'rounded-full bg-[#d92636] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-[0_3px_8px_rgba(217,38,54,0.22)]'
                : 'rounded-full bg-[#c77700] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white'
            }>
              {contact.attentionState === 'needs_reply' ? 'Needs reply' : 'Waiting on contact'}
            </span>
            <div>
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
            <span className="text-xs font-black uppercase tracking-wide text-red-700">Overdue</span>
          )}
          {contact.nextAction && (
            <button
              type="button"
              onClick={completePrimaryAction}
              disabled={completingTask}
              className="rounded-md border border-[#df3038] bg-white px-3 py-1.5 text-xs font-bold text-[#b91c26] transition-colors hover:bg-[#fff7f7] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completingTask ? 'Completing…' : 'Mark complete'}
            </button>
          )}
          {taskError && <p className="w-full text-xs font-medium text-red-700">{taskError}</p>}
        </div>
      )}

      {/* Chat Content */}
      <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,rgba(40,104,215,0.055),transparent_32%),linear-gradient(180deg,#fbfaf8,#f5f2ed)] px-6 py-5 scroll-smooth">
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

      <div className="flex shrink-0 gap-2 border-t border-[#e1ddd7] bg-white px-4 pt-3">
        {[
          { label: 'I can call at 2:30', tone: 'border-[#8bc9bf] bg-[#eefaf7] text-[#087f70] hover:bg-[#ddf4ee]' },
          { label: 'Send property details', tone: 'border-[#a9c5f4] bg-[#f2f7ff] text-[#2868d7] hover:bg-[#e5efff]' },
          { label: 'Book appointment', tone: 'border-[#c9bdf0] bg-[#f6f3ff] text-[#7357c7] hover:bg-[#ebe5ff]' },
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
      <ComposeBox leadId={leadId} phone={phone} email={email} onSent={onSent} replyFromPhone={contact.toPhone} draftMessage={quickDraft} draftVersion={quickDraftVersion} initialMode={initialComposeMode} />
    </section>
  )
}
