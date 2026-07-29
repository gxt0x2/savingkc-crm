'use client'

import { useRef, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { MessageBubble, type Message } from './message-bubble'
import { ComposeBox } from './compose-box'

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
  onSent,
  onConversationChanged,
}: {
  contact: ThreadContact
  dateGroups: DateGroup[]
  leadId?: string
  phone?: string
  onSent?: () => void
  onConversationChanged?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [completingTask, setCompletingTask] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)

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

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfcfd]">
      {/* Thread Header */}
      <header className="flex h-[76px] flex-shrink-0 items-center justify-between border-b border-[#dde2e8] bg-white px-5">
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
                <span className="rounded border border-[#7ab98d] bg-[#f3faf5] px-2 py-0.5 text-[10px] font-bold text-[#0f7136]">{contact.attentionState === 'needs_reply' ? 'Needs reply' : 'Active'}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="flex h-9 items-center gap-1.5 rounded-md border border-[#cfd5dc] bg-white px-3 text-xs font-bold text-[#253247]"><Icon name="call" className="text-[17px]" /> Call</button>
          <button className="flex h-9 w-9 items-center justify-center rounded-md border border-[#cfd5dc] bg-white"><Icon name="videocam" className="text-[18px]" /></button>
          <button className="flex h-9 w-9 items-center justify-center rounded-md border border-[#cfd5dc] bg-white">
            <Icon name="more_vert" className="text-on-surface-variant" />
          </button>
        </div>
      </header>

      {(contact.attentionState !== 'resolved' || contact.nextAction) && (
        <div className="mx-5 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#ecd08d] bg-[#fffbef] px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className={
              contact.attentionState === 'needs_reply'
                ? 'rounded-full bg-[#e5f5ea] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[#0e7135]'
                : 'rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-800'
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
              className="rounded-md border border-[#138a42] bg-white px-3 py-1.5 text-xs font-bold text-[#0f7136] transition-colors hover:bg-[#f3faf5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completingTask ? 'Completing…' : 'Mark complete'}
            </button>
          )}
          {taskError && <p className="w-full text-xs font-medium text-red-700">{taskError}</p>}
        </div>
      )}

      {/* Chat Content */}
      <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto px-6 py-5 scroll-smooth">
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

      <div className="flex shrink-0 gap-2 border-t border-[#e1e6eb] bg-white px-4 pt-3">
        {['I can call at 2:30', 'Send property details', 'Book appointment'].map((reply) => (
          <button
            key={reply}
            type="button"
            className="rounded-md border border-[#138a42] bg-white px-3 py-1.5 text-xs font-semibold text-[#0f7136] hover:bg-[#f3faf5]"
          >
            {reply}
          </button>
        ))}
      </div>

      {/* Compose Box — reply from the same number the lead texted */}
      <ComposeBox leadId={leadId} phone={phone} onSent={onSent} replyFromPhone={contact.toPhone} />
    </section>
  )
}
