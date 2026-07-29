'use client'

import { useState } from 'react'
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

export function InboxSidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onNewMessage,
}: {
  threads: ThreadPreview[]
  activeThreadId: string
  onSelectThread: (id: string) => void
  onNewMessage?: () => void
}) {
  const [activeTab, setActiveTab] = useState<TabFilter>('unread')
  const [search, setSearch] = useState('')

  const filteredThreads = threads.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false
    if (activeTab === 'unread') return t.unread
    if (activeTab === 'mine') return Boolean(t.owner)
    if (activeTab === 'unassigned') return !t.owner
    return true
  })

  const tabs: { key: TabFilter; label: string; count: number }[] = [
    { key: 'unread', label: 'Inbox', count: threads.filter((thread) => thread.unread).length },
    { key: 'mine', label: 'Mine', count: threads.filter((thread) => thread.owner).length },
    { key: 'unassigned', label: 'Unassigned', count: threads.filter((thread) => !thread.owner).length },
    { key: 'all', label: 'All', count: threads.length },
  ]

  return (
    <aside className="flex h-full w-[330px] flex-col border-r border-[#dde2e8] bg-white text-sm font-semibold">
      <div className="border-b border-[#e4e8ed]">
        {/* Header */}
        <div className="flex h-[76px] items-center justify-between px-5">
          <h1 className="text-[22px] font-bold text-[#111827]">Conversations</h1>
          <button className="flex h-9 items-center gap-1 rounded-md bg-[#138a42] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0f7136]" onClick={onNewMessage}>
            <Icon name="add" className="text-[18px]" /> New
          </button>
        </div>

        <div className="flex px-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex-1 border-b-2 px-1 py-3 text-xs transition-colors',
                activeTab === tab.key ? 'border-[#138a42] text-[#0f7136]' : 'border-transparent text-slate-500',
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
            className="w-full rounded-md border border-[#d9dee5] bg-white py-2.5 pl-9 pr-3 text-xs text-slate-700 outline-none focus:border-[#138a42]"
            placeholder="Search conversations"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 border-t border-[#eef1f4] px-4 py-2">
          <button className="flex h-8 items-center gap-1 rounded border border-[#d9dee5] px-3 text-[11px] text-slate-600">All channels <Icon name="expand_more" /></button>
          <button className="flex h-8 items-center rounded border border-[#d9dee5] px-3 text-[11px] text-slate-600">Needs reply</button>
          <button className="ml-auto flex h-8 w-8 items-center justify-center rounded border border-[#d9dee5] text-slate-500"><Icon name="filter_list" /></button>
        </div>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto">
        {filteredThreads.map((thread) => {
          const isActive = thread.id === activeThreadId
          return (
            <div
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              className={cn('cursor-pointer border-b border-[#edf0f3] px-4 py-4 transition-colors', isActive ? 'bg-[#f3faf5]' : 'bg-white hover:bg-[#f8fafb]')}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'h-11 w-11 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold',
                    thread.avatarBg,
                    thread.avatarText
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
                            ? 'bg-[#e5f5ea] text-[#0e7135]'
                            : 'bg-amber-100 text-amber-800'
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
                            ? 'bg-error-container text-on-error-container'
                            : 'bg-surface-container-highest text-on-surface-variant'
                        )}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                  <p className="line-clamp-2 text-[12px] font-normal leading-4 text-slate-500">{thread.lastMessage}</p>
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
            </div>
          )
        })}
      </div>
    </aside>
  )
}
