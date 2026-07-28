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

function formatPhonePill(raw?: string): string {
  if (!raw) return '(816) 307-7835'
  const digits = raw.replace(/\D/g, '')
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
  }
  return raw
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
    <section className="flex-1 flex flex-col bg-surface min-w-0">
      {/* Thread Header */}
      <header className="bg-surface-container-low px-8 py-6 flex justify-between items-center flex-shrink-0">
        <div className="flex gap-6 items-center">
          <div className="w-14 h-14 rounded-full bg-slate-900 flex items-center justify-center text-white text-xl font-black">
            {contact.initials}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black text-primary tracking-tight">
                {contact.name}
              </h2>
              {contact.verified && (
                <Icon name="verified" className="text-secondary text-lg" filled />
              )}
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-sm font-medium text-on-surface-variant">
                {contact.address}
              </span>
              <span className="text-xs text-on-surface-variant/40">&bull;</span>
              <span className="text-sm font-medium text-on-surface-variant">
                {contact.county}
              </span>
              <div className="flex gap-2 ml-2">
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
                {/* Receiving phone pill */}
                <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded border border-blue-100">
                  {formatPhonePill(contact.toPhone)}
                </span>
                {/* Assigned agent pill */}
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded border border-slate-200">
                  👤 {contact.owner || contact.assignedAgent || 'Unassigned'}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            className="text-sm font-bold text-primary border-b-2 border-primary-fixed pb-0.5 hover:border-primary transition-all cursor-pointer"
            href={leadId ? `/leads/${leadId}` : '#'}
          >
            View Profile
          </a>
          <button className="p-2 bg-white rounded-lg shadow-sm">
            <Icon name="more_vert" className="text-on-surface-variant" />
          </button>
        </div>
      </header>

      {(contact.attentionState !== 'resolved' || contact.nextAction) && (
        <div className="mx-8 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className={
              contact.attentionState === 'needs_reply'
                ? 'rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-red-800'
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
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completingTask ? 'Completing…' : 'Mark complete'}
            </button>
          )}
          {taskError && <p className="w-full text-xs font-medium text-red-700">{taskError}</p>}
        </div>
      )}

      {/* Chat Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth">
        {dateGroups.map((group) => (
          <div key={group.label} className="space-y-8">
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

      {/* Compose Box — reply from the same number the lead texted */}
      <ComposeBox leadId={leadId} phone={phone} onSent={onSent} replyFromPhone={contact.toPhone} />
    </section>
  )
}
