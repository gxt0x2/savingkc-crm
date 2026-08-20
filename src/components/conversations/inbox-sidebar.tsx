'use client'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { CallOutcomePresentation } from '@/lib/operating-model/conversation-presentation'
import type { ConversationQueue } from '@/lib/queries/conversation-hub'

export type { ConversationQueue } from '@/lib/queries/conversation-hub'

export interface ThreadPreview {
  id: string
  threadKey: string
  name: string
  initials: string
  avatarBg: string
  avatarText: string
  address: string
  lastMessage: string
  lastChannel: 'call' | 'sms' | 'email' | 'voicemail' | null
  lastCallOutcome?: CallOutcomePresentation | null
  activityAt: string
  timestamp: string
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

const QUEUES: Array<{ key: ConversationQueue; label: string }> = [
  { key: 'needs_reply', label: 'Needs Reply' },
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'all', label: 'All' },
]

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

function emptyQueueMessage(queue: ConversationQueue, search: string) {
  if (search.trim().length >= 3) return `No conversations match “${search.trim()}”.`
  if (queue === 'needs_reply') return 'Nothing needs a reply.'
  if (queue === 'mine') return 'No conversations are assigned to you.'
  if (queue === 'unassigned') return 'No conversations are waiting for an owner.'
  return 'No conversations yet.'
}

function QueueSkeleton() {
  return (
    <div role="status" aria-label="Loading conversation queue" className="space-y-1 p-3">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="flex animate-pulse gap-3 rounded-xl border border-[var(--crm-border)] p-3">
          <span className="h-10 w-10 shrink-0 rounded-full bg-[var(--crm-surface-subtle)]" />
          <span className="flex-1 space-y-2 py-1">
            <span className="block h-3 w-2/3 rounded bg-[var(--crm-surface-subtle)]" />
            <span className="block h-3 w-full rounded bg-[var(--crm-surface-subtle)]" />
          </span>
        </div>
      ))}
    </div>
  )
}

export function InboxSidebar({
  threads,
  activeThreadKey,
  activeQueue,
  search,
  loading = false,
  error = null,
  onSelectThread,
  onQueueChange,
  onSearchChange,
  onRetry,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onNewMessage,
}: {
  threads: ThreadPreview[]
  activeThreadKey: string
  activeQueue: ConversationQueue
  search: string
  loading?: boolean
  error?: string | null
  onSelectThread: (threadKey: string) => void
  onQueueChange: (queue: ConversationQueue) => void
  onSearchChange: (search: string) => void
  onRetry?: () => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  onNewMessage?: () => void
}) {
  return (
    <aside aria-label="Conversation inbox" className="flex h-full w-full flex-col border-r border-[var(--crm-border)] bg-[var(--crm-surface)] text-sm font-semibold md:w-[340px]">
      <div className="shrink-0 border-b border-[var(--crm-border)] bg-[var(--crm-surface)]">
        <div className="flex h-[68px] items-center justify-between px-4 md:h-[76px] md:px-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">Team inbox</p>
            <h1 className="mt-0.5 text-xl font-black text-[var(--crm-ink)] md:text-[22px]">Conversations</h1>
          </div>
          <button type="button" className="crm-primary-button flex h-9 items-center gap-1 rounded-lg px-3 text-xs font-bold" onClick={onNewMessage}>
            <Icon name="search" className="text-[18px]" /> Find
          </button>
        </div>

        <div aria-label="Conversation queues" role="group" className="grid grid-cols-4 px-3 md:px-4">
          {QUEUES.map((queue) => (
            <button
              key={queue.key}
              type="button"
              onClick={() => onQueueChange(queue.key)}
              aria-pressed={activeQueue === queue.key}
              className={cn(
                'min-w-0 border-b-2 px-1 py-3 text-[11px] font-black transition-colors',
                activeQueue === queue.key
                  ? 'border-[var(--crm-brand)] text-[var(--crm-brand)]'
                  : 'border-transparent text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]',
              )}
            >
              <span className="block truncate">{queue.label}</span>
            </button>
          ))}
        </div>

        <label className="relative mx-4 my-3 block">
          <span className="sr-only">Search conversations</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--crm-text-muted)]" />
          <input
            aria-label="Search conversations"
            className="crm-field h-10 w-full rounded-lg pl-9 pr-3 text-xs outline-none"
            placeholder="Search name, phone, or property"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        {search.trim().length > 0 && search.trim().length < 3 ? <p role="status" className="-mt-1 px-4 pb-3 text-[10px] font-semibold text-[var(--crm-text-muted)]">Type at least 3 characters to search.</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? <QueueSkeleton /> : null}

        {!loading && error ? (
          <div role="alert" className="m-4 rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] p-4 text-center">
            <Icon name="error" className="text-[22px] text-[var(--crm-danger)]" />
            <p className="mt-2 text-sm font-black text-[var(--crm-ink)]">Conversations could not be loaded</p>
            <p className="mt-1 text-xs font-medium text-[var(--crm-text-muted)]">{error}</p>
            {onRetry ? <button type="button" onClick={onRetry} className="crm-secondary-button mt-3 rounded-lg px-3 py-2 text-xs font-black">Retry conversations</button> : null}
          </div>
        ) : null}

        {!loading && !error && threads.length === 0 ? (
          <div role="status" className="px-6 py-12 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--crm-success-soft)] text-[var(--crm-success)]"><Icon name="inbox" /></span>
            <p className="mt-3 text-sm font-black text-[var(--crm-ink)]">{emptyQueueMessage(activeQueue, search)}</p>
            <p className="mt-1 text-xs font-medium leading-5 text-[var(--crm-text-muted)]">This queue is calculated by the CRM, not by this browser.</p>
          </div>
        ) : null}

        {!loading && !error ? threads.map((thread) => {
          const isActive = thread.threadKey === activeThreadKey
          const channelMeta = thread.lastChannel === 'call' && thread.lastCallOutcome
            ? { icon: thread.lastCallOutcome.icon, tone: OUTCOME_TONE[thread.lastCallOutcome.tone] }
            : thread.lastChannel
              ? CHANNEL_META[thread.lastChannel]
              : null

          return (
            <button
              key={thread.threadKey}
              type="button"
              onClick={() => onSelectThread(thread.threadKey)}
              aria-pressed={isActive}
              aria-label={`Open conversation with ${thread.name}`}
              className={cn(
                'w-full border-b border-l-4 border-b-[var(--crm-border)] px-4 py-3.5 text-left transition-colors',
                isActive
                  ? 'border-l-[var(--crm-brand)] bg-[var(--crm-surface-selected)]'
                  : 'border-l-transparent bg-[var(--crm-surface)] hover:bg-[var(--crm-surface-subtle)]',
              )}
            >
              <div className="flex items-start gap-3">
                <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-black', thread.avatarBg, thread.avatarText, isActive && 'ring-2 ring-[var(--crm-brand-border)] ring-offset-2 ring-offset-[var(--crm-surface)]')}>
                  {thread.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="truncate text-sm font-black text-[var(--crm-ink)]">{thread.name}</span>
                    <span className="shrink-0 text-[10px] font-medium text-[var(--crm-text-dim)]">{thread.timestamp}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {thread.attentionState !== 'resolved' ? (
                      <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide', thread.attentionState === 'needs_reply' ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]')}>
                        {thread.attentionState === 'needs_reply' ? 'Needs Reply' : 'Waiting'}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1.5 flex items-start gap-1.5 text-[12px] font-medium leading-4 text-[var(--crm-text-muted)]">
                    {channelMeta ? <Icon name={channelMeta.icon} className={cn('mt-0.5 shrink-0 text-[14px]', channelMeta.tone)} /> : null}
                    <span className="line-clamp-2">{thread.lastMessage}</span>
                  </span>
                  <span className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                    <span className={cn('truncate', thread.nextAction?.overdue ? 'font-black text-[var(--crm-danger)]' : 'text-[var(--crm-text-muted)]')}>
                      {thread.nextAction?.title || (thread.attentionState === 'needs_reply' ? 'Reply required' : 'No next action')}
                    </span>
                    <span className="shrink-0 text-[var(--crm-text-dim)]">{thread.owner || 'Unassigned'}</span>
                  </span>
                </span>
              </div>
            </button>
          )
        }) : null}
        {!loading && !error && hasMore && onLoadMore ? (
          <div className="p-3">
            <button type="button" onClick={onLoadMore} disabled={loadingMore} className="crm-secondary-button flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-black disabled:opacity-60">
              <Icon name={loadingMore ? 'progress_activity' : 'expand_more'} className={loadingMore ? 'animate-spin' : ''} />
              {loadingMore ? 'Loading…' : 'Load more conversations'}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
