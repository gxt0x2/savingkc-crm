'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const items = [
  { label: 'Conversations', icon: 'forum', href: '/conversations', count: 0 },
  { label: 'Opportunities', icon: 'paid', href: '/contacts?list=hot' },
  { label: 'Contacts', icon: 'group', href: '/contacts' },
  { label: 'Calendar & Tasks', icon: 'calendar_month', href: '/calendar?department=acquisitions' },
  { label: 'Workflows', icon: 'account_tree', href: '/workflows' },
  { label: 'Marketing', icon: 'campaign', href: '/marketing' },
  { label: 'Dispositions', icon: 'sell', href: '/dispo' },
  { label: 'Reports', icon: 'bar_chart', href: '/dashboard' },
  { label: 'Settings', icon: 'settings', href: '/settings' },
]

export function WorkspaceNav({ needsReply }: { needsReply: number }) {
  return (
    <aside className="hidden w-[190px] shrink-0 flex-col bg-[#0a2138] text-white lg:flex">
      <Link href="/ari" className="flex h-[76px] items-center border-b border-white/10 px-5">
        <Image
          src="/logo.png"
          alt="Saving KC Homebuyers"
          width={150}
          height={40}
          className="h-10 w-auto brightness-0 invert"
        />
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
                  ? 'bg-white/12 text-white shadow-[inset_3px_0_0_#e32e2e]'
                  : 'text-white/72 hover:bg-white/8 hover:text-white',
                index === 4 && 'mt-5 border-t border-white/10 pt-5',
              )}
            >
              <Icon name={item.icon} className={cn('text-[20px]', active ? 'text-[#ff5962]' : 'text-white/70')} />
              <span className="min-w-0 flex-1">{item.label}</span>
              {active && needsReply > 0 ? (
                <span className="rounded-full bg-[#e32e2e] px-2 py-0.5 text-[10px] font-black text-white">
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
