'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { useThemePreference } from '@/hooks/use-theme-preference'
import { WorkspaceNav } from './workspace-nav'

export function WorkspaceFrame({
  children,
  needsReply,
}: {
  children: React.ReactNode
  needsReply?: number
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [hubNeedsReply, setHubNeedsReply] = useState(0)
  const { theme, toggle: toggleTheme } = useThemePreference()
  const resolvedNeedsReply = needsReply ?? hubNeedsReply

  useEffect(() => {
    if (needsReply != null) return
    let active = true
    fetch('/api/conversations/hub', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Conversation state unavailable')))
      .then((payload: { items?: { attentionState?: string }[] }) => {
        if (active) setHubNeedsReply((payload.items ?? []).filter((item) => item.attentionState === 'needs_reply').length)
      })
      .catch(() => {
        if (active) setHubNeedsReply(0)
      })
    return () => { active = false }
  }, [needsReply])

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const query = search.trim()
    router.push(query ? `/contacts?search=${encodeURIComponent(query)}` : '/contacts')
  }

  return (
    <div
      className="crm-workspace-shell flex h-screen overflow-hidden bg-[var(--crm-canvas)] text-[var(--crm-ink)]"
      data-theme={theme}
    >
      <WorkspaceNav needsReply={resolvedNeedsReply} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="crm-shell-header flex h-[62px] shrink-0 items-center border-b px-6 backdrop-blur">
          <form onSubmit={submitSearch} className="relative w-full max-w-[610px]">
            <span className="sr-only">Search contacts, properties, or messages</span>
            <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[21px] text-[var(--crm-text-muted)]" />
            <input
              aria-label="Search contacts, properties, or messages"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="crm-search-field h-10 w-full rounded-lg pl-12 pr-4 text-sm outline-none"
              placeholder="Search contacts, properties, or messages..."
            />
          </form>
          <div className="ml-auto flex items-center gap-5">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
              className="crm-icon-button flex h-10 w-10 items-center justify-center rounded-lg"
            >
              <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} className="text-[22px]" />
            </button>
            <div className="relative">
              <button type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-expanded={notificationsOpen} className="crm-icon-button relative flex h-10 w-10 items-center justify-center rounded-lg text-[var(--crm-brand)]" aria-label="Notifications">
                <Icon name="notifications_none" className="text-[25px]" />
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--crm-brand)] px-1 text-[10px] font-bold text-white">{resolvedNeedsReply}</span>
              </button>
              {notificationsOpen ? <div className="crm-menu absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-xl"><div className="border-b border-[var(--crm-border)] px-4 py-3 text-sm font-bold">Action center</div><Link href="/conversations" onClick={() => setNotificationsOpen(false)} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--crm-brand-soft)]"><Icon name="forum" className="mt-0.5 text-[var(--crm-brand)]" /><span><strong className="block text-sm">{resolvedNeedsReply} conversation{resolvedNeedsReply === 1 ? '' : 's'} need a reply</strong><span className="text-xs text-[var(--crm-text-muted)]">Open the team inbox</span></span></Link><Link href="/calendar?department=acquisitions" onClick={() => setNotificationsOpen(false)} className="flex items-start gap-3 border-t border-[var(--crm-border)] px-4 py-3 hover:bg-[var(--crm-brand-soft)]"><Icon name="calendar_month" className="mt-0.5 text-[var(--crm-brand)]" /><span><strong className="block text-sm">Review tasks and appointments</strong><span className="text-xs text-[var(--crm-text-muted)]">Open the acquisition calendar</span></span></Link></div> : null}
            </div>
            <div className="relative">
            <button type="button" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen} aria-label="Open user menu" className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--crm-surface-subtle)]">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-xs font-bold text-[var(--crm-surface)]">ED</div>
              <span className="text-sm font-semibold text-[var(--crm-ink)]">Ernest</span>
              <Icon name="expand_more" className="text-[var(--crm-text-muted)]" />
            </button>
            {profileOpen ? <div className="crm-menu absolute right-0 top-12 z-50 w-44 overflow-hidden rounded-xl py-1"><Link href="/settings" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold hover:bg-[var(--crm-surface-subtle)]"><Icon name="settings" className="text-[18px]" />Settings</Link><Link href="/dashboard" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold hover:bg-[var(--crm-surface-subtle)]"><Icon name="bar_chart" className="text-[18px]" />Reports</Link></div> : null}
            </div>
          </div>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
