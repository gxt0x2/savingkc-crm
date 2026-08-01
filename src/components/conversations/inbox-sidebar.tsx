'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import type { PersonalityType } from '@/types'
import type { CallOutcomePresentation } from '@/lib/operating-model/conversation-presentation'
import type { ConversationDecisionTag } from '@/lib/operating-model/conversation-tags'

export interface ThreadPreview {
  id: string
  name: string
  initials: string
  avatarBg: string
  avatarText: string
  address: string
  personality: PersonalityType | null
  tags: ConversationDecisionTag[]
  lastMessage: string
  lastChannel: 'call' | 'sms' | 'email' | 'voicemail' | null
  lastCallOutcome?: CallOutcomePresentation | null
  timestamp: string
  unread?: boolean
  starred?: boolean
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

type TabFilter = 'agent' | 'team' | 'needs_reply'

const CHANNEL_META = {
  call: { icon: 'call', tone: 'text-[var(--crm-info)]' },
  sms: { icon: 'chat_bubble', tone: 'text-[var(--crm-success)]' },
  email: { icon: 'mail', tone: 'text-[var(--crm-info)]' },
  voicemail: { icon: 'voicemail', tone: 'text-[var(--crm-violet)]' },
} as const

const OUTCOME_TONE = {
  positive: 'text-[var(--crm-success)]',
  attention: 'text-[var(--crm-violet)]',
  negative: 'text-[var(--crm-brand)]',
  neutral: 'text-[var(--crm-text-muted)]',
} as const

const TAG_TONE = {
  brand: 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]',
  info: 'border-[var(--crm-info)]/30 bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
  success: 'border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  violet: 'border-[var(--crm-violet)]/30 bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]',
  neutral: 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]',
} as const

export function InboxSidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onNewMessage,
  currentUserName = 'Ernest',
}: {
  threads: ThreadPreview[]
  activeThreadId: string
  onSelectThread: (id: string) => void
  onNewMessage?: () => void
  currentUserName?: string
}) {
  const [activeTab, setActiveTab] = useState<TabFilter>('needs_reply')
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState('')
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [sortOrder, setSortOrder] = useState<'priority' | 'recent'>('priority')

  const filteredThreads = useMemo(() => threads.filter((t) => {
    if (search && !`${t.name} ${t.address}`.toLowerCase().includes(search.toLowerCase())) return false
    if (channel && t.lastChannel !== channel) return false
    if (unassignedOnly && t.owner) return false
    if (activeTab === 'agent') return Boolean(t.owner && t.owner.toLowerCase().startsWith(currentUserName.toLowerCase()))
    if (activeTab === 'needs_reply') return t.attentionState === 'needs_reply'
    return true
  }).sort((a, b) => {
    if (sortOrder === 'recent') return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    const rank = (thread: ThreadPreview) => thread.attentionState === 'needs_reply' ? 0 : thread.nextAction?.overdue ? 1 : 2
    return rank(a) - rank(b)
  }), [activeTab, channel, currentUserName, search, sortOrder, threads, unassignedOnly])

  useEffect(() => {
    if (filteredThreads.length === 0) return
    if (!filteredThreads.some((thread) => thread.id === activeThreadId)) {
      onSelectThread(filteredThreads[0].id)
    }
  }, [activeThreadId, filteredThreads, onSelectThread])

  const tabs: { key: TabFilter; label: string; count: number }[] = [
    { key: 'agent', label: 'Agent', count: threads.filter((thread) => thread.owner?.toLowerCase().startsWith(currentUserName.toLowerCase())).length },
    { key: 'team', label: 'Team', count: threads.length },
    { key: 'needs_reply', label: 'Needs Reply', count: threads.filter((thread) => thread.attentionState === 'needs_reply').length },
  ]

  return (
    <aside className="flex h-full w-[330px] flex-col border-r border-[var(--crm-border)] bg-[var(--crm-surface)] text-sm font-semibold">
      <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface)]">
        {/* Header */}
        <div className="flex h-[76px] items-center justify-between px-5">
          <h1 className="text-[22px] font-bold text-[var(--crm-ink)]">Conversations</h1>
          <button type="button" className="crm-primary-button flex h-9 items-center gap-1 rounded-lg px-3 text-xs font-bold" onClick={onNewMessage}>
            <Icon name="add" className="text-[18px]" /> New
          </button>
        </div>

        <div className="flex px-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={activeTab === tab.key}
              className={cn(
                'flex-1 border-b-2 px-1 py-3 text-xs transition-colors',
                activeTab === tab.key ? 'border-[var(--crm-brand)] text-[var(--crm-brand)]' : 'border-transparent text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]',
              )}
            >
              {tab.label} <span className="ml-1 text-[10px]">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="relative mx-4 my-3">
          <Icon
            name="search"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400"
          />
          <input
            aria-label="Search conversations"
            className="crm-field w-full rounded-lg py-2.5 pl-9 pr-3 text-xs outline-none"
            placeholder="Search conversations"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--crm-border)] px-4 py-2">
          <select aria-label="Filter by channel" value={channel} onChange={(event) => setChannel(event.target.value)} className="crm-field h-8 rounded-lg px-2 text-[11px]">
            <option value="">All channels</option>
            <option value="sms">SMS</option>
            <option value="call">Calls</option>
            <option value="email">Email</option>
            <option value="voicemail">Voicemail</option>
          </select>
          <button
            type="button"
            onClick={() => setUnassignedOnly((value) => !value)}
            aria-pressed={unassignedOnly}
            className={cn('flex h-8 items-center rounded-lg border px-3 text-[11px]', unassignedOnly ? 'border-[var(--crm-violet)]/30 bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' : 'border-[var(--crm-border)] text-[var(--crm-text-muted)]')}
          >
            Unassigned
          </button>
          <button type="button" onClick={() => setSortOrder((value) => value === 'priority' ? 'recent' : 'priority')} aria-label={`Sort conversations by ${sortOrder === 'priority' ? 'recent activity' : 'priority'}`} title={`Sort: ${sortOrder}`} className="crm-icon-button ml-auto flex h-8 w-8 items-center justify-center rounded-lg"><Icon name={sortOrder === 'priority' ? 'filter_list' : 'schedule'} /></button>
        </div>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto">
        {filteredThreads.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs font-medium text-slate-500">No conversations match these filters.</div>
        ) : null}
        {filteredThreads.map((thread) => {
          const isActive = thread.id === activeThreadId
          const channelMeta = thread.lastChannel === 'call' && thread.lastCallOutcome
            ? { icon: thread.lastCallOutcome.icon, tone: OUTCOME_TONE[thread.lastCallOutcome.tone] }
            : thread.lastChannel
              ? CHANNEL_META[thread.lastChannel]
              : null
          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => onSelectThread(thread.id)}
              aria-pressed={isActive}
              className={cn(
                'w-full border-b border-l-4 border-b-[var(--crm-border)] px-4 py-4 text-left transition-colors',
                isActive
                  ? 'border-l-[var(--crm-brand)] bg-[var(--crm-surface-selected)]'
                  : 'border-l-transparent bg-[var(--crm-surface)] hover:bg-[var(--crm-surface-subtle)]',
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'h-11 w-11 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold',
                    thread.avatarBg,
                    thread.avatarText,
                    isActive && 'ring-2 ring-[var(--crm-brand-border)] ring-offset-2'
                  )}
                >
                  {thread.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-bold text-sm truncate">{thread.name}</span>
                    <span className="text-[10px] text-on-surface-variant/60 flex-shrink-0">
                      {thread.timestamp}
                    </span>
                  </div>
                  <div className="mb-1 flex gap-2">
                    {thread.attentionState !== 'resolved' && (
                      <span
                        className={cn(
                          'px-2 py-0.5 text-[9px] rounded-full uppercase tracking-tighter',
                          thread.attentionState === 'needs_reply'
                            ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
                            : 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]'
                        )}
                      >
                        {thread.attentionState === 'needs_reply' ? 'Needs Reply' : 'Waiting'}
                      </span>
                    )}
                    {thread.personality && (
                      <span
                        className={cn(
                          'px-2 py-0.5 text-[9px] rounded-full uppercase tracking-tighter',
                          thread.personality === 'assertive'
                            ? 'bg-secondary-container text-on-secondary-container'
                            : 'bg-surface-container-highest text-on-surface-variant'
                        )}
                      >
                        {thread.personality}
                      </span>
                    )}
                    {thread.tags.map((tag) => (
                      <span
                        key={tag.id}
                        title={`${tag.category}: ${tag.label}`}
                        className={cn('rounded-full border px-2 py-0.5 text-[9px] font-bold', TAG_TONE[tag.tone])}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                  <p className="flex items-start gap-1.5 text-[12px] font-normal leading-4 text-slate-500">
                    {channelMeta ? <Icon name={channelMeta.icon} className={cn('mt-0.5 shrink-0 text-[14px]', channelMeta.tone)} /> : null}
                    <span className="line-clamp-2">{thread.lastMessage}</span>
                  </p>
                  {(thread.nextAction || thread.owner) && (
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                      <span className={cn(
                        'truncate',
                        thread.nextAction?.overdue ? 'font-bold text-[var(--crm-danger)]' : 'text-[var(--crm-text-muted)]',
                      )}>
                        {thread.nextAction?.title || 'No primary action'}
                      </span>
                      <span className="shrink-0 text-slate-400">{thread.owner || 'Unassigned'}</span>
                    </div>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
