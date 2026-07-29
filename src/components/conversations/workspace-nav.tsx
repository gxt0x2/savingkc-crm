'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const items = [
  { label: 'Conversations', icon: 'forum', href: '/conversations', count: 0 },
  { label: 'Opportunities', icon: 'paid', href: '/contacts?list=hot' },
  { label: 'Contacts', icon: 'group', href: '/contacts' },
  { label: 'Calendar & Tasks', icon: 'calendar_month', href: '/calendar?department=acquisitions' },
  { label: 'Workflows', icon: 'account_tree', href: '/workflows' },
  { label: 'Marketing', icon: 'campaign', href: '/marketing' },
  { label: 'Dispositions', icon: 'sell', href: '/dispo/pipeline' },
  { label: 'Reports', icon: 'bar_chart', href: '/dashboard' },
  { label: 'Settings', icon: 'settings', href: '/settings' },
]

export function WorkspaceNav({ needsReply }: { needsReply: number }) {
  return (
    <aside className="hidden w-[230px] shrink-0 flex-col bg-[#062d50] text-white lg:flex">
      <Link href="/ari" className="flex h-[76px] items-center border-b border-white/10 px-5">
        <div className="flex items-center gap-2">
          <Icon name="home_work" className="text-[34px] text-white" />
          <div className="leading-none">
            <p className="text-[20px] font-bold tracking-tight">Saving<span className="text-[#32a852]">KC</span></p>
            <p className="mt-1 text-[11px] font-bold tracking-[0.18em] text-white/90">CRM</p>
          </div>
        </div>
      </Link>
      <nav className="flex-1 space-y-1 px-3 py-5">
        {items.map((item, index) => {
          const active = index === 0
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-3 text-[13px] font-semibold transition-colors',
                active
                  ? 'bg-white/12 text-white shadow-[inset_3px_0_0_#2baa55]'
                  : 'text-white/72 hover:bg-white/8 hover:text-white',
                index === 4 && 'mt-5 border-t border-white/10 pt-5',
              )}
            >
              <Icon name={item.icon} className={cn('text-[20px]', active ? 'text-white' : 'text-white/70')} />
              <span className="min-w-0 flex-1">{item.label}</span>
              {active && needsReply > 0 ? (
                <span className="rounded-full bg-[#25a64d] px-2 py-0.5 text-[10px] font-black text-white">
                  {needsReply}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>
      <button className="m-4 flex items-center gap-2 border-t border-white/10 pt-4 text-xs font-semibold text-white/70">
        <Icon name="chevron_left" />
        Collapse
      </button>
    </aside>
  )
}
