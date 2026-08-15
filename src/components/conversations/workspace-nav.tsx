'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { SystemAndon } from '@/components/feedback/system-andon'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { isCaseyCrmUser } from '@/lib/telephony/agent-identity'

type NavItem = { label: string; icon: string; href: string; activeOn: string[] }

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: 'home', href: '/dashboard', activeOn: ['/dashboard'] },
  { label: 'Issue Log', icon: 'warning_amber', href: '/reports/andon', activeOn: ['/reports/andon', '/reports/bottlenecks'] },
  { label: 'Pipeline', icon: 'account_tree', href: '/contacts?list=contacted', activeOn: ['/contacts', '/leads', '/opportunities', '/in-closing'] },
  { label: 'Conversations', icon: 'forum', href: '/conversations', activeOn: ['/conversations'] },
  { label: 'Calendar', icon: 'calendar_month', href: '/calendar?department=acquisitions', activeOn: ['/calendar'] },
  { label: 'Dialer', icon: 'dialpad', href: '/dialer', activeOn: ['/dialer'] },
  { label: 'Task', icon: 'checklist', href: '/tasks', activeOn: ['/tasks'] },
  { label: 'Reports', icon: 'bar_chart', href: '/reports/acquisitions', activeOn: ['/reports/acquisitions', '/reports/dispositions', '/reports/marketing', '/reports/finance', '/reports/call-sms'] },
  { label: 'Settings', icon: 'settings', href: '/settings', activeOn: ['/settings'] },
]

const CASEY_NAV_ITEMS: NavItem[] = [
  { label: 'My Day', icon: 'today', href: '/my-day', activeOn: ['/my-day'] },
  ...NAV_ITEMS.filter((item) => ['Pipeline', 'Conversations', 'Calendar', 'Dialer', 'Task', 'Settings'].includes(item.label)),
]

function isItemActive(item: NavItem, pathname: string) {
  return item.activeOn.some((prefix) => pathname.startsWith(prefix))
}

function WorkspaceNavLink({ item, pathname, collapsed, needsReply }: { item: NavItem; pathname: string; collapsed: boolean; needsReply: number }) {
  const active = isItemActive(item, pathname)
  return (
    <Link
      href={item.href}
      prefetch
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'relative flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-semibold transition-colors',
        collapsed && 'justify-center',
        active
          ? 'bg-[var(--crm-nav-active)] text-[var(--crm-nav-text)] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--crm-brand)]'
          : 'text-[var(--crm-nav-muted)] hover:bg-[var(--crm-nav-hover)] hover:text-[var(--crm-nav-text)]',
      )}
    >
      <Icon name={item.icon} className={cn('text-[19px]', active ? 'text-[var(--crm-brand)]' : 'text-current')} />
      <span className={cn('min-w-0 flex-1 truncate', collapsed && 'sr-only')}>{item.label}</span>
      {item.label === 'Conversations' && needsReply > 0 ? <span className="rounded-full bg-[var(--crm-brand)] px-1.5 py-0.5 text-[9px] font-black text-white">{needsReply}</span> : null}
    </Link>
  )
}

export function WorkspaceNav({ needsReply, userEmail }: { needsReply: number; userEmail?: string | null }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const isCasey = isCaseyCrmUser(userEmail)
  const navItems = isCasey ? CASEY_NAV_ITEMS : NAV_ITEMS

  return (
    <aside className={cn('hidden shrink-0 flex-col border-r border-black/15 bg-[var(--crm-nav)] text-[var(--crm-nav-text)] transition-[width] duration-200 lg:flex', collapsed ? 'w-[64px]' : 'w-[192px]')}>
      <svg width="0" height="0" aria-hidden="true"><filter id="crm-logo-dark" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 -0.5 -0.5 0 1 -1 0 0 0 1 -1 0 0 0 1 0 0 0 1 0" /></filter></svg>
      <Link href={isCasey ? '/my-day' : '/dashboard'} prefetch aria-label="Saving KC CRM dashboard" className={cn('flex h-[68px] items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-4')}>
        <Image src="/logo.png" alt={collapsed ? '' : 'Saving KC Homebuyers'} width={489} height={141} className={cn('h-auto object-contain', collapsed ? 'w-[48px]' : 'w-[138px]')} style={{ filter: 'url(#crm-logo-dark)' }} />
      </Link>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2.5 py-3" aria-label="CRM navigation">
        {navItems.map((item) => <WorkspaceNavLink key={item.label} item={item} pathname={pathname} collapsed={collapsed} needsReply={needsReply} />)}
      </nav>
      <div className="space-y-2 border-t border-white/10 px-3 pb-3 pt-3">
        <SystemAndon collapsed={collapsed} />
        <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} className={cn('flex w-full items-center gap-2 pt-1 text-xs font-semibold text-[var(--crm-nav-muted)] hover:text-[var(--crm-nav-text)]', collapsed && 'justify-center')}><Icon name={collapsed ? 'chevron_right' : 'chevron_left'} />{collapsed ? <span className="sr-only">Expand</span> : 'Collapse'}</button>
      </div>
    </aside>
  )
}
