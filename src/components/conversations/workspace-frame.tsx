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
        <header className="relative flex h-[66px] shrink-0 items-center border-b border-[#ded9d1] bg-white/95 px-6 shadow-[0_4px_18px_rgba(16,40,63,0.05)] backdrop-blur">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,#d92636_0%,#e76f51_28%,#c77700_52%,#087f70_76%,#2868d7_100%)]" aria-hidden="true" />
          <form onSubmit={submitSearch} className="relative w-full max-w-[610px]">
            <span className="sr-only">Search contacts, properties, or messages</span>
            <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[21px] text-[#566579]" />
            <input
              aria-label="Search contacts, properties, or messages"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-11 w-full rounded-lg border border-[#d8d2ca] bg-[#fbfaf8] pl-12 pr-4 text-sm text-[#26374d] outline-none placeholder:text-[#7a8797] focus:border-[#2868d7] focus:bg-white focus:ring-4 focus:ring-[#2868d7]/10"
              placeholder="Search contacts, properties, or messages..."
            />
          </form>
          <div className="ml-auto flex items-center gap-5">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)] transition-colors hover:bg-[var(--ck-surface-hi)] hover:text-[var(--ck-text)]"
            >
              <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} className="text-[22px]" />
            </button>
            <div className="relative">
              <button type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-expanded={notificationsOpen} className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#fff0f1] text-[#b91f2d] transition-colors hover:bg-[#ffe3e6]" aria-label="Notifications">
                <Icon name="notifications_none" className="text-[25px]" />
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d92636] px-1 text-[10px] font-bold text-white shadow-[0_2px_7px_rgba(217,38,54,0.35)]">{resolvedNeedsReply}</span>
              </button>
              {notificationsOpen ? <div className="absolute right-0 top-10 z-50 w-72 overflow-hidden rounded-lg border border-[#d9dfe6] bg-white shadow-xl"><div className="border-b border-[#e4e7ec] px-4 py-3 text-sm font-black">Action center</div><Link href="/conversations" onClick={() => setNotificationsOpen(false)} className="flex items-start gap-3 px-4 py-3 hover:bg-[#fff8f8]"><Icon name="forum" className="mt-0.5 text-[#b91c26]" /><span><strong className="block text-sm">{resolvedNeedsReply} conversation{resolvedNeedsReply === 1 ? '' : 's'} need a reply</strong><span className="text-xs text-[#667085]">Open the team inbox</span></span></Link><Link href="/calendar?department=acquisitions" onClick={() => setNotificationsOpen(false)} className="flex items-start gap-3 border-t border-[#eef1f4] px-4 py-3 hover:bg-[#fff8f8]"><Icon name="calendar_month" className="mt-0.5 text-[#b91c26]" /><span><strong className="block text-sm">Review tasks and appointments</strong><span className="text-xs text-[#667085]">Open the acquisition calendar</span></span></Link></div> : null}
            </div>
            <div className="relative">
            <button type="button" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen} aria-label="Open user menu" className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[#f7f8fa]">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0b2942,#2868d7)] text-xs font-bold text-white shadow-[0_3px_10px_rgba(40,104,215,0.25)]">ED</div>
              <span className="text-sm font-semibold text-[#17263b]">Ernest</span>
              <Icon name="expand_more" className="text-[#17263b]" />
            </button>
            {profileOpen ? <div className="absolute right-0 top-12 z-50 w-44 overflow-hidden rounded-lg border border-[#d9dfe6] bg-white py-1 shadow-xl"><Link href="/settings" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f7f8fa]"><Icon name="settings" className="text-[18px]" />Settings</Link><Link href="/dashboard" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f7f8fa]"><Icon name="bar_chart" className="text-[18px]" />Reports</Link></div> : null}
            </div>
          </div>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
