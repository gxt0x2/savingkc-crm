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
}

type TabFilter = 'all' | 'unread' | 'recents' | 'starred'

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
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const [search, setSearch] = useState('')

  const filteredThreads = threads.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false
    if (activeTab === 'unread') return t.unread
    if (activeTab === 'starred') return t.starred
    return true
  })

  const tabs: { key: TabFilter; label: string; dot?: boolean }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', dot: threads.some((t) => t.unread) },
    { key: 'recents', label: 'Recents' },
    { key: 'starred', label: 'Starred' },
  ]

  return (
    <aside className="w-80 bg-slate-100 flex flex-col h-full border-r border-slate-200/50 text-sm font-semibold">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between px-2">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Inbox</h1>
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/60 font-bold">
              Unified Messaging
            </p>
          </div>
          <button className="p-2 bg-white rounded-lg shadow-sm" onClick={onNewMessage}>
            <Icon name="edit_square" className="text-primary" />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Icon
            name="search"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-sm"
          />
          <input
            className="w-full bg-surface-container-high/50 border-none rounded-xl pl-9 py-2.5 text-xs focus:ring-1 focus:ring-primary/20 focus:outline-none"
            placeholder="Search contacts..."
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Quick Tabs */}
        <div className="flex gap-1 p-1 bg-surface-container-high/40 rounded-xl">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex-1 py-1.5 rounded-lg text-[11px] relative transition-all duration-200',
                activeTab === tab.key
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:bg-slate-200/50'
              )}
            >
              {tab.label}
              {tab.dot && activeTab !== tab.key && (
                <span className="absolute top-0 right-1 w-1.5 h-1.5 bg-on-tertiary-container rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {filteredThreads.map((thread) => {
          const isActive = thread.id === activeThreadId
          return (
            <div
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              className={cn(
                'p-3 rounded-lg cursor-pointer transition-transform duration-200',
                isActive
                  ? 'bg-white text-slate-950 shadow-sm translate-x-1'
                  : 'hover:bg-slate-200/50'
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold',
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
                  {thread.address && (
                    <div className="text-[11px] text-primary/70 mb-1 flex items-center gap-1">
                      {isActive && <Icon name="location_on" className="text-[12px]" />}
                      {!isActive && (
                        <span className="text-on-surface-variant/70">{thread.address}</span>
                      )}
                      {isActive && thread.address}
                    </div>
                  )}
                  <div className="flex gap-2 mb-2">
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
                  <p
                    className={cn(
                      'text-[12px] text-on-surface-variant line-clamp-1 font-normal',
                      isActive ? 'italic' : 'opacity-60'
                    )}
                  >
                    {isActive ? `"${thread.lastMessage}"` : thread.lastMessage}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
