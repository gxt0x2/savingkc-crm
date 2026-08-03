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
  activityAt: string
  timestamp: string
  unread?: boolean
  hot?: boolean
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

type TabFilter = 'agent' | 'team' | 'recent' | 'hot'
type OwnerFilter = 'casey' | 'ernest' | 'gertha' | 'team' | 'unassigned'
type DateRangeFilter = 'all' | 'today' | '7_days' | '30_days' | 'custom'
type AttentionFilter = 'all' | ThreadPreview['attentionState']
type NextActionFilter = 'all' | 'overdue' | 'missing'

const OWNER_FILTERS: { value: OwnerFilter; label: string }[] = [
  { value: 'casey', label: 'Casey' },
  { value: 'ernest', label: 'Ernest' },
  { value: 'gertha', label: 'Gertha' },
  { value: 'team', label: 'Team' },
  { value: 'unassigned', label: 'Unassigned' },
]

const DAY_IN_MS = 86_400_000

function activityTimestamp(thread: ThreadPreview) {
  const timestamp = new Date(thread.activityAt).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function localDayStart(timestamp: number) {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

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
  const [activeTab, setActiveTab] = useState<TabFilter>('team')
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState('')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('team')
  const [sortOrder, setSortOrder] = useState<'priority' | 'recent'>('priority')
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('all')
  const [nextActionFilter, setNextActionFilter] = useState<NextActionFilter>('all')
  const [referenceNow] = useState(() => Date.now())

  const currentUserOwnerFilter = useMemo<OwnerFilter>(() => {
    const normalizedName = currentUserName.trim().toLowerCase()
    return OWNER_FILTERS.find((option) => option.value !== 'team' && option.value !== 'unassigned' && normalizedName.startsWith(option.value))?.value || 'team'
  }, [currentUserName])

  const panelFilterCount = Number(dateRange !== 'all') + Number(attentionFilter !== 'all') + Number(nextActionFilter !== 'all')

  function clearPanelFilters() {
    setDateRange('all')
    setCustomStart('')
    setCustomEnd('')
    setAttentionFilter('all')
    setNextActionFilter('all')
  }

  const filteredThreads = useMemo(() => threads.filter((t) => {
    if (search && !`${t.name} ${t.address}`.toLowerCase().includes(search.toLowerCase())) return false
    if (channel && t.lastChannel !== channel) return false
    if (ownerFilter === 'unassigned' && t.owner) return false
    if (ownerFilter !== 'team' && ownerFilter !== 'unassigned' && !t.owner?.toLowerCase().startsWith(ownerFilter)) return false
    if (activeTab === 'agent' && !t.owner?.toLowerCase().startsWith(currentUserOwnerFilter)) return false
    if (activeTab === 'hot' && !t.hot) return false
    if (attentionFilter !== 'all' && t.attentionState !== attentionFilter) return false
    if (nextActionFilter === 'overdue' && !t.nextAction?.overdue) return false
    if (nextActionFilter === 'missing' && t.nextAction) return false
    const timestamp = activityTimestamp(t)
    if (dateRange === 'today' && timestamp < localDayStart(referenceNow)) return false
    if (dateRange === '7_days' && timestamp < referenceNow - (7 * DAY_IN_MS)) return false
    if (dateRange === '30_days' && timestamp < referenceNow - (30 * DAY_IN_MS)) return false
    if (dateRange === 'custom') {
      const start = customStart ? new Date(`${customStart}T00:00:00`).getTime() : null
      const end = customEnd ? new Date(`${customEnd}T23:59:59.999`).getTime() : null
      if (start !== null && timestamp < start) return false
      if (end !== null && timestamp > end) return false
    }
    return true
  }).sort((a, b) => {
    if (activeTab === 'recent' || sortOrder === 'recent') return activityTimestamp(b) - activityTimestamp(a)
    const rank = (thread: ThreadPreview) => thread.attentionState === 'needs_reply' ? 0 : thread.nextAction?.overdue ? 1 : 2
    return rank(a) - rank(b)
  }), [activeTab, attentionFilter, channel, currentUserOwnerFilter, customEnd, customStart, dateRange, nextActionFilter, ownerFilter, referenceNow, search, sortOrder, threads])

  useEffect(() => {
    if (filteredThreads.length === 0) return
    if (!filteredThreads.some((thread) => thread.id === activeThreadId)) {
      onSelectThread(filteredThreads[0].id)
    }
  }, [activeThreadId, filteredThreads, onSelectThread])

  const tabs: { key: TabFilter; label: string; count: number }[] = [
    { key: 'agent', label: currentUserName, count: threads.filter((thread) => thread.owner?.toLowerCase().startsWith(currentUserOwnerFilter)).length },
    { key: 'team', label: 'Team', count: threads.length },
    { key: 'recent', label: 'Recent', count: threads.length },
    { key: 'hot', label: 'Hot', count: threads.filter((thread) => thread.hot).length },
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
              onClick={() => {
                setActiveTab(tab.key)
                setOwnerFilter(tab.key === 'agent' ? currentUserOwnerFilter : 'team')
              }}
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
        <div className="relative flex items-center gap-1.5 border-t border-[var(--crm-border)] px-4 py-2">
          <select aria-label="Filter by channel" value={channel} onChange={(event) => setChannel(event.target.value)} className="crm-field h-8 w-[94px] rounded-lg px-2 text-[11px]">
            <option value="">All channels</option>
            <option value="sms">SMS</option>
            <option value="call">Calls</option>
            <option value="email">Email</option>
            <option value="voicemail">Voicemail</option>
          </select>
          <select
            aria-label="Filter by assigned team member"
            value={ownerFilter}
            onChange={(event) => {
              setOwnerFilter(event.target.value as OwnerFilter)
              setActiveTab('team')
            }}
            className="crm-field h-8 min-w-0 flex-1 rounded-lg px-2 text-[11px]"
          >
            {OWNER_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => { setFilterMenuOpen((value) => !value); setSortMenuOpen(false) }}
            aria-expanded={filterMenuOpen}
            aria-label={`Conversation filters${panelFilterCount ? `, ${panelFilterCount} active` : ''}`}
            title="Filters"
            className={cn('crm-icon-button relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', panelFilterCount && 'border-[var(--crm-action)] bg-[var(--crm-action-soft)] text-[var(--crm-action)]')}
          >
            <Icon name="filter_alt" />
            {panelFilterCount ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--crm-action)] px-1 text-[9px] font-black text-white">{panelFilterCount}</span> : null}
          </button>
          <button
            type="button"
            onClick={() => { setSortMenuOpen((value) => !value); setFilterMenuOpen(false) }}
            aria-expanded={sortMenuOpen}
            aria-label="Sort conversations"
            title={`Sort: ${sortOrder === 'priority' ? 'Priority first' : 'Recent activity'}`}
            className="crm-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          >
            <Icon name={sortOrder === 'priority' ? 'swap_vert' : 'schedule'} />
          </button>
          {filterMenuOpen ? (
            <div role="dialog" aria-label="Filter conversations" className="crm-menu absolute right-4 top-11 z-50 w-[286px] rounded-xl p-4 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black text-[var(--crm-ink)]">Filters</h2>
                  <p className="mt-0.5 text-[10px] font-medium text-[var(--crm-text-muted)]">Narrow the shared inbox without losing its queue.</p>
                </div>
                {panelFilterCount ? <button type="button" onClick={clearPanelFilters} className="text-[11px] font-bold text-[var(--crm-action)] hover:underline">Clear</button> : null}
              </div>
              <label className="mt-4 block text-[10px] font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">
                Date range
                <select aria-label="Conversation date range" value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRangeFilter)} className="crm-field mt-1.5 h-9 w-full rounded-lg px-2 text-xs font-semibold normal-case tracking-normal">
                  <option value="all">All time</option>
                  <option value="today">Today</option>
                  <option value="7_days">Last 7 days</option>
                  <option value="30_days">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </label>
              {dateRange === 'custom' ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-[10px] font-bold text-[var(--crm-text-muted)]">From<input aria-label="Conversation start date" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="crm-field mt-1 h-9 w-full rounded-lg px-2 text-[11px]" /></label>
                  <label className="text-[10px] font-bold text-[var(--crm-text-muted)]">To<input aria-label="Conversation end date" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="crm-field mt-1 h-9 w-full rounded-lg px-2 text-[11px]" /></label>
                </div>
              ) : null}
              <label className="mt-3 block text-[10px] font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">
                Reply state
                <select aria-label="Conversation reply state" value={attentionFilter} onChange={(event) => setAttentionFilter(event.target.value as AttentionFilter)} className="crm-field mt-1.5 h-9 w-full rounded-lg px-2 text-xs font-semibold normal-case tracking-normal">
                  <option value="all">All states</option>
                  <option value="needs_reply">Needs reply</option>
                  <option value="waiting_on_contact">Waiting on contact</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
              <label className="mt-3 block text-[10px] font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">
                Next action
                <select aria-label="Conversation next action" value={nextActionFilter} onChange={(event) => setNextActionFilter(event.target.value as NextActionFilter)} className="crm-field mt-1.5 h-9 w-full rounded-lg px-2 text-xs font-semibold normal-case tracking-normal">
                  <option value="all">All actions</option>
                  <option value="overdue">Overdue only</option>
                  <option value="missing">Missing next action</option>
                </select>
              </label>
              <button type="button" onClick={() => setFilterMenuOpen(false)} className="crm-primary-button mt-4 h-9 w-full rounded-lg text-xs font-bold">Show results</button>
            </div>
          ) : null}
          {sortMenuOpen ? (
            <div role="dialog" aria-label="Sort conversations" className="crm-menu absolute right-4 top-11 z-50 w-48 overflow-hidden rounded-xl py-1 shadow-xl">
              {([['priority', 'Priority first'], ['recent', 'Recent activity']] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => { setSortOrder(value); setSortMenuOpen(false) }} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold hover:bg-[var(--crm-surface-subtle)]">
                  {label}{sortOrder === value ? <Icon name="check" className="text-[15px] text-[var(--crm-action)]" /> : null}
                </button>
              ))}
            </div>
          ) : null}
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
                            : 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]'
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
