'use client'

import { Icon } from '@/components/ui/icon'
import { WorkspaceNav } from './workspace-nav'

export function WorkspaceFrame({
  children,
  needsReply = 0,
}: {
  children: React.ReactNode
  needsReply?: number
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-white text-[#132238]">
      <WorkspaceNav needsReply={needsReply} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[66px] shrink-0 items-center border-b border-[#dde3e9] bg-white px-6">
          <label className="relative w-full max-w-[610px]">
            <span className="sr-only">Search contacts, properties, or messages</span>
            <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[21px] text-[#566579]" />
            <input
              className="h-11 w-full rounded-md border border-[#ccd4dd] bg-white pl-12 pr-4 text-sm text-[#26374d] outline-none placeholder:text-[#7a8797] focus:border-[#138a42] focus:ring-2 focus:ring-[#138a42]/10"
              placeholder="Search contacts, properties, or messages..."
            />
          </label>
          <div className="ml-auto flex items-center gap-5">
            <button className="relative text-[#132238]" aria-label="Notifications">
              <Icon name="notifications_none" className="text-[25px]" />
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#df3038] px-1 text-[10px] font-bold text-white">2</span>
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#18334b] text-xs font-bold text-white">ED</div>
              <span className="text-sm font-semibold text-[#17263b]">Ernest</span>
              <Icon name="expand_more" className="text-[#17263b]" />
            </div>
          </div>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
