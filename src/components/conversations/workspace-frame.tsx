'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { WorkspaceNav } from './workspace-nav'

export function WorkspaceFrame({
  children,
  needsReply = 0,
}: {
  children: React.ReactNode
  needsReply?: number
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const query = search.trim()
    router.push(query ? `/contacts?search=${encodeURIComponent(query)}` : '/contacts')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white text-[#132238]">
      <WorkspaceNav needsReply={needsReply} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[66px] shrink-0 items-center border-b border-[#dde3e9] bg-white px-6">
          <form onSubmit={submitSearch} className="relative w-full max-w-[610px]">
            <span className="sr-only">Search contacts, properties, or messages</span>
            <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[21px] text-[#566579]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-11 w-full rounded-md border border-[#ccd4dd] bg-white pl-12 pr-4 text-sm text-[#26374d] outline-none placeholder:text-[#7a8797] focus:border-[#df3038] focus:ring-2 focus:ring-[#df3038]/10"
              placeholder="Search contacts, properties, or messages..."
            />
          </form>
          <div className="ml-auto flex items-center gap-5">
            <div className="relative">
              <button type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-expanded={notificationsOpen} className="relative text-[#132238]" aria-label="Notifications">
                <Icon name="notifications_none" className="text-[25px]" />
                <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#df3038] px-1 text-[10px] font-bold text-white">{needsReply}</span>
              </button>
              {notificationsOpen ? <div className="absolute right-0 top-10 z-50 w-72 overflow-hidden rounded-lg border border-[#d9dfe6] bg-white shadow-xl"><div className="border-b border-[#e4e7ec] px-4 py-3 text-sm font-black">Action center</div><Link href="/conversations" onClick={() => setNotificationsOpen(false)} className="flex items-start gap-3 px-4 py-3 hover:bg-[#fff8f8]"><Icon name="forum" className="mt-0.5 text-[#b91c26]" /><span><strong className="block text-sm">{needsReply} conversation{needsReply === 1 ? '' : 's'} need a reply</strong><span className="text-xs text-[#667085]">Open the team inbox</span></span></Link><Link href="/calendar?department=acquisitions" onClick={() => setNotificationsOpen(false)} className="flex items-start gap-3 border-t border-[#eef1f4] px-4 py-3 hover:bg-[#fff8f8]"><Icon name="calendar_month" className="mt-0.5 text-[#b91c26]" /><span><strong className="block text-sm">Review tasks and appointments</strong><span className="text-xs text-[#667085]">Open the acquisition calendar</span></span></Link></div> : null}
            </div>
            <div className="relative">
            <button type="button" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[#f7f8fa]">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#18334b] text-xs font-bold text-white">ED</div>
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
