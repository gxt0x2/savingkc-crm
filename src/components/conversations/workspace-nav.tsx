'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const items = [
  { label: 'Conversations', icon: 'forum', href: '/conversations', activeOn: ['/conversations'] },
  { label: 'Opportunities', icon: 'paid', href: '/opportunities', activeOn: ['/opportunities', '/leads'] },
  { label: 'Contacts', icon: 'group', href: '/contacts', activeOn: ['/contacts'] },
  { label: 'Calendar & Tasks', icon: 'calendar_month', href: '/calendar?department=acquisitions', activeOn: ['/calendar'] },
  { label: 'Workflows', icon: 'account_tree', href: '/workflows', activeOn: ['/workflows'] },
  { label: 'Marketing', icon: 'campaign', href: '/marketing', activeOn: ['/marketing'] },
  { label: 'Dispositions', icon: 'sell', href: '/dispo/pipeline', activeOn: ['/dispo'] },
  { label: 'Reports', icon: 'bar_chart', href: '/dashboard', activeOn: ['/dashboard'] },
  { label: 'Settings', icon: 'settings', href: '/settings', activeOn: ['/settings'] },
]

export function WorkspaceNav({ needsReply }: { needsReply: number }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  return (
    <aside className={cn('hidden shrink-0 flex-col border-r border-black/15 bg-[var(--crm-nav)] text-[var(--crm-nav-text)] transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-[230px]')}>
      <svg width="0" height="0" aria-hidden="true">
        <filter id="crm-logo-dark" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0 -0.5 -0.5 0 1
                    -1 0 0 0 1
                    -1 0 0 0 1
                    0 0 0 1 0"
          />
        </filter>
      </svg>
      <Link href="/conversations" aria-label="Saving KC CRM home" className={cn('flex h-[76px] items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-5')}>
        {collapsed ? <Image
          src="/logo.png"
          alt=""
          width={489}
          height={141}
          className="h-auto w-[58px] object-contain"
          style={{ filter: 'url(#crm-logo-dark)' }}
        /> : <Image
          src="/logo.png"
          alt="Saving KC Homebuyers"
          width={489}
          height={141}
          className="h-auto w-[155px] object-contain"
          style={{ filter: 'url(#crm-logo-dark)' }}
        />}
      </Link>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((item, index) => {
          const active = item.activeOn.some((prefix) => pathname.startsWith(prefix))
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                'relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-colors',
                collapsed && 'justify-center',
                active
                  ? 'bg-[var(--crm-nav-active)] text-[var(--crm-nav-text)] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--crm-brand)]'
                  : 'text-[var(--crm-nav-muted)] hover:bg-[var(--crm-nav-hover)] hover:text-[var(--crm-nav-text)]',
                index === 4 && 'mt-5 border-t border-white/10 pt-5',
              )}
            >
              <Icon name={item.icon} className={cn('text-[20px]', active ? 'text-[var(--crm-brand)]' : 'text-current')} />
              <span className={cn('min-w-0 flex-1', collapsed && 'sr-only')}>{item.label}</span>
              {item.label === 'Conversations' && needsReply > 0 ? (
                <span className="rounded-full bg-[var(--crm-brand)] px-2 py-0.5 text-[10px] font-black text-white">
                  {needsReply}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>
      <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} className={cn('m-4 flex items-center gap-2 border-t border-white/10 pt-4 text-xs font-semibold text-[var(--crm-nav-muted)] hover:text-[var(--crm-nav-text)]', collapsed && 'justify-center')}>
        <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} />
        {collapsed ? <span className="sr-only">Expand</span> : 'Collapse'}
      </button>
    </aside>
  )
}
