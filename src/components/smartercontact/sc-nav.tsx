'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/icon'

/** SmarterContact-parity secondary navigation, shared by all /sc pages. */
const SC_TABS = [
  { label: 'Messenger', href: '/messenger', icon: 'chat', match: '/messenger' },
  { label: 'Contacts', href: '/contacts', icon: 'contacts', match: '/contacts' },
  { label: 'Campaigns', href: '/campaigns', icon: 'campaign', match: '/campaigns' },
  { label: 'Workflows', href: '/workflows', icon: 'account_tree', match: '/workflows' },
  { label: 'Dialer', href: '/dialer', icon: 'phone_in_talk', match: '/dialer' },
  { label: 'Calendar', href: '/calendar', icon: 'calendar_today', match: '/calendar' },
  { label: 'Skiptrace', href: '/skiptrace', icon: 'travel_explore', match: '/skiptrace' },
  { label: 'Reporting', href: '/reporting', icon: 'insights', match: '/reporting' },
]

export function ScNav() {
  const pathname = usePathname() || ''
  return (
    <div className="border-b border-[var(--ck-border)] bg-[var(--ck-surface)]">
      <nav className="flex items-center gap-1 overflow-x-auto px-4 h-12">
        {SC_TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.match + '/') || pathname === tab.match
          return (
            <Link
              key={tab.label}
              href={tab.href}
              prefetch={false}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md whitespace-nowrap transition-colors ${
                active
                  ? 'bg-[#E32E2E]/15 text-white'
                  : 'text-[var(--ck-text-muted)] hover:bg-white/5 hover:text-[var(--ck-text)]'
              }`}
            >
              <Icon
                name={tab.icon}
                size="text-base"
                className={active ? 'text-[#E32E2E]' : 'text-[var(--ck-text-dim)]'}
              />
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
