'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import type { PersonalityType } from '@/types'

export interface ThreadPreview {
  id: string
  name: string
  initials: string
  avatarBg: string
  avatarText: string
  address: string
  personality: PersonalityType | null
  tags: { label: string; variant: 'hot' | 'default' }[]
  lastMessage: string
  lastChannel: 'call' | 'sms' | 'email' | 'voicemail' | null
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

type TabFilter = 'all' | 'unread' | 'mine' | 'unassigned'

const CHANNEL_META = {
  call: { icon: 'call', tone: 'text-[#d92636]' },
  sms: { icon: 'chat_bubble', tone: 'text-[#087f70]' },
  email: { icon: 'mail', tone: 'text-[#2868d7]' },
  voicemail: { icon: 'voicemail', tone: 'text-[#7357c7]' },
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
  const [activeTab, setActiveTab] = useState<TabFilter>('unread')
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState('')
  const [needsReplyOnly, setNeedsReplyOnly] = useState(false)
  const [sortOrder, setSortOrder] = useState<'priority' | 'recent'>('priority')

  const filteredThreads = useMemo(() => threads.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false
    if (channel && t.lastChannel !== channel) return false
    if (needsReplyOnly && t.attentionState !== 'needs_reply') return false
    if (activeTab === 'unread') return t.unread
    if (activeTab === 'mine') return Boolean(t.owner && t.owner.toLowerCase().startsWith(currentUserName.toLowerCase()))
    if (activeTab === 'unassigned') return !t.owner
    return true
  }).sort((a, b) => {
    if (sortOrder === 'recent') return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    const rank = (thread: ThreadPreview) => thread.attentionState === 'needs_reply' ? 0 : thread.nextAction?.overdue ? 1 : 2
    return rank(a) - rank(b)
  }), [activeTab, channel, currentUserName, needsReplyOnly, search, sortOrder, threads])

  useEffect(() => {
    if (filteredThreads.length === 0) return
    if (!filteredThreads.some((thread) => thread.id === activeThreadId)) {
      onSelectThread(filteredThreads[0].id)
    }
  }, [activeThreadId, filteredThreads, onSelectThread])

  const tabs: { key: TabFilter; label: string; count: number }[] = [
    { key: 'unread', label: 'Inbox', count: threads.filter((thread) => thread.unread).length },
    { key: 'mine', label: 'Mine', count: threads.filter((thread) => thread.owner?.toLowerCase().startsWith(currentUserName.toLowerCase())).length },
    { key: 'unassigned', label: 'Unassigned', count: threads.filter((thread) => !thread.owner).length },
    { key: 'all', label: 'All', count: threads.length },
  ]

  return (
    <aside className="flex h-full w-[330px] flex-col border-r border-[#ded9d1] bg-[#fffdfb] text-sm font-semibold">
      <div className="border-b border-[#e7e1da] bg-[linear-gradient(180deg,#ffffff_0%,#fffaf7_100%)]">
        {/* Header */}
        <div className="flex h-[76px] items-center justify-between px-5">
          <h1 className="text-[22px] font-bold text-[#111827]">Conversations</h1>
          <button type="button" className="flex h-9 items-center gap-1 rounded-lg bg-[linear-gradient(135deg,#d92636,#e76f51)] px-3 text-xs font-bold text-white shadow-[0_5px_14px_rgba(217,38,54,0.22)] hover:brightness-95" onClick={onNewMessage}>
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
                activeTab === tab.key ? 'border-[#d92636] text-[#b91f2d]' : 'border-transparent text-slate-500 hover:text-[#0b2942]',
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
            className="w-full rounded-md border border-[#d9dee5] bg-white py-2.5 pl-9 pr-3 text-xs text-slate-700 outline-none focus:border-[#df3038]"
            placeholder="Search conversations"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 border-t border-[#eef1f4] px-4 py-2">
          <select aria-label="Filter by channel" value={channel} onChange={(event) => setChannel(event.target.value)} className="h-8 rounded border border-[#d9dee5] px-2 text-[11px] text-slate-600">
            <option value="">All channels</option>
            <option value="sms">SMS</option>
            <option value="call">Calls</option>
            <option value="email">Email</option>
            <option value="voicemail">Voicemail</option>
          </select>
          <button
            type="button"
            onClick={() => setNeedsReplyOnly((value) => !value)}
            aria-pressed={needsReplyOnly}
            className={cn('flex h-8 items-center rounded border px-3 text-[11px]', needsReplyOnly ? 'border-[#f3a5aa] bg-[#fff0f1] text-[#b91f2d] shadow-[0_2px_8px_rgba(217,38,54,0.08)]' : 'border-[#d9dee5] text-slate-600')}
          >
            Needs reply
          </button>
          <button type="button" onClick={() => setSortOrder((value) => value === 'priority' ? 'recent' : 'priority')} aria-label={`Sort conversations by ${sortOrder === 'priority' ? 'recent activity' : 'priority'}`} title={`Sort: ${sortOrder}`} className="ml-auto flex h-8 w-8 items-center justify-center rounded border border-[#d9dee5] text-slate-500 hover:text-[#b91c26]"><Icon name={sortOrder === 'priority' ? 'filter_list' : 'schedule'} /></button>
        </div>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto">
        {filteredThreads.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs font-medium text-slate-500">No conversations match these filters.</div>
        ) : null}
        {filteredThreads.map((thread) => {
          const isActive = thread.id === activeThreadId
          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => onSelectThread(thread.id)}
              aria-pressed={isActive}
              className={cn(
                'w-full border-b border-l-4 border-b-[#ede8e2] px-4 py-4 text-left transition-all',
                isActive
                  ? 'border-l-[#d92636] bg-[linear-gradient(90deg,#fff0f1_0%,#fffaf8_62%,#ffffff_100%)] shadow-[inset_0_1px_0_rgba(217,38,54,0.04)]'
                  : 'border-l-transparent bg-[#fffdfb] hover:border-l-[#2868d7] hover:bg-[#f7faff]',
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'h-11 w-11 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold',
                    thread.avatarBg,
                    thread.avatarText,
                    isActive && 'ring-2 ring-[#d92636]/20 ring-offset-2'
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
                            ? 'bg-[#ffe5e7] text-[#ad1e2b]'
                            : 'bg-[#fff0c7] text-[#975800]'
                        )}
                      >
                        {thread.attentionState === 'needs_reply' ? 'Needs reply' : 'Waiting'}
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
                        key={tag.label}
                        className={cn(
                          'px-2 py-0.5 text-[9px] rounded-full uppercase tracking-tighter',
                          tag.variant === 'hot'
                            ? 'bg-[#fff0e9] text-[#c64f35]'
                            : 'bg-surface-container-highest text-on-surface-variant'
                        )}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                  <p className="flex items-start gap-1.5 text-[12px] font-normal leading-4 text-slate-500">
                    {thread.lastChannel ? <Icon name={CHANNEL_META[thread.lastChannel].icon} className={cn('mt-0.5 shrink-0 text-[14px]', CHANNEL_META[thread.lastChannel].tone)} /> : null}
                    <span className="line-clamp-2">{thread.lastMessage}</span>
                  </p>
                  {(thread.nextAction || thread.owner) && (
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                      <span className={cn(
                        'truncate',
                        thread.nextAction?.overdue ? 'font-bold text-red-700' : 'text-slate-500',
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
