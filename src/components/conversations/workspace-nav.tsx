'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type NavItem = { label: string; icon: string; href: string; activeOn: string[] }

const PRIMARY_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: 'home', href: '/dashboard', activeOn: ['/dashboard'] },
  { label: 'Contacts', icon: 'group', href: '/contacts', activeOn: ['/contacts', '/leads', '/opportunities', '/in-closing'] },
  { label: 'Conversations', icon: 'forum', href: '/conversations', activeOn: ['/conversations'] },
  { label: 'Dialer', icon: 'dialpad', href: '/dialer', activeOn: ['/dialer'] },
  { label: 'Calendar', icon: 'calendar_month', href: '/calendar?department=acquisitions', activeOn: ['/calendar'] },
  { label: 'Task', icon: 'checklist', href: '/tasks', activeOn: ['/tasks'] },
]

const REPORT_ITEMS: NavItem[] = [
  { label: 'Marketing', icon: 'campaign', href: '/reports/marketing', activeOn: ['/reports/marketing'] },
  { label: 'Acquisitions', icon: 'track_changes', href: '/reports/acquisitions', activeOn: ['/reports/acquisitions'] },
  { label: 'Dispositions', icon: 'sell', href: '/reports/dispositions', activeOn: ['/reports/dispositions'] },
  { label: 'Finance', icon: 'account_balance', href: '/reports/finance', activeOn: ['/reports/finance'] },
  { label: 'Call/SMS', icon: 'phone_in_talk', href: '/reports/call-sms', activeOn: ['/reports/call-sms'] },
]

const OPERATING_ITEMS: NavItem[] = [
  { label: 'AI Assistant', icon: 'smart_toy', href: '/ai', activeOn: ['/ai'] },
  { label: 'ARI Insights', icon: 'auto_awesome', href: '/ari', activeOn: ['/ari'] },
  { label: 'Workflows', icon: 'account_tree', href: '/workflows', activeOn: ['/workflows'] },
  { label: 'Settings', icon: 'settings', href: '/settings', activeOn: ['/settings'] },
]

function isItemActive(item: NavItem, pathname: string) {
  return item.activeOn.some((prefix) => pathname.startsWith(prefix))
}

function WorkspaceNavLink({ item, pathname, collapsed, needsReply }: { item: NavItem; pathname: string; collapsed: boolean; needsReply: number }) {
  const active = isItemActive(item, pathname)
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-colors',
        collapsed && 'justify-center',
        active
          ? 'bg-[var(--crm-nav-active)] text-[var(--crm-nav-text)] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--crm-brand)]'
          : 'text-[var(--crm-nav-muted)] hover:bg-[var(--crm-nav-hover)] hover:text-[var(--crm-nav-text)]',
      )}
    >
      <Icon name={item.icon} className={cn('text-[20px]', active ? 'text-[var(--crm-brand)]' : 'text-current')} />
      <span className={cn('min-w-0 flex-1', collapsed && 'sr-only')}>{item.label}</span>
      {item.label === 'Conversations' && needsReply > 0 ? <span className="rounded-full bg-[var(--crm-brand)] px-2 py-0.5 text-[10px] font-black text-white">{needsReply}</span> : null}
    </Link>
  )
}

export function WorkspaceNav({ needsReply }: { needsReply: number }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const reportsActive = pathname.startsWith('/reports')
  const [reportsPreference, setReportsPreference] = useState<boolean | null>(null)
  const reportsOpen = reportsPreference ?? reportsActive

  function toggleReports() {
    if (collapsed) {
      setCollapsed(false)
      setReportsPreference(true)
      return
    }
    setReportsPreference(!reportsOpen)
  }

  return (
    <aside className={cn('hidden shrink-0 flex-col border-r border-black/15 bg-[var(--crm-nav)] text-[var(--crm-nav-text)] transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-[230px]')}>
      <svg width="0" height="0" aria-hidden="true"><filter id="crm-logo-dark" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 -0.5 -0.5 0 1 -1 0 0 0 1 -1 0 0 0 1 0 0 0 1 0" /></filter></svg>
      <Link href="/dashboard" aria-label="Saving KC CRM dashboard" className={cn('flex h-[76px] items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-5')}>
        <Image src="/logo.png" alt={collapsed ? '' : 'Saving KC Homebuyers'} width={489} height={141} className={cn('h-auto object-contain', collapsed ? 'w-[58px]' : 'w-[155px]')} style={{ filter: 'url(#crm-logo-dark)' }} />
      </Link>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="CRM navigation">
        {PRIMARY_ITEMS.map((item) => <WorkspaceNavLink key={item.label} item={item} pathname={pathname} collapsed={collapsed} needsReply={needsReply} />)}
        <div className="pt-1">
          <button type="button" onClick={toggleReports} aria-expanded={reportsOpen} className={cn('relative flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors', collapsed && 'justify-center', reportsActive ? 'bg-[var(--crm-nav-active)] text-[var(--crm-nav-text)]' : 'text-[var(--crm-nav-muted)] hover:bg-[var(--crm-nav-hover)] hover:text-[var(--crm-nav-text)]')}>
            {reportsActive ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[var(--crm-brand)]" /> : null}
            <Icon name="bar_chart" className={cn('text-[20px]', reportsActive && 'text-[var(--crm-brand)]')} />
            <span className={cn('min-w-0 flex-1', collapsed && 'sr-only')}>Reports</span>
            {collapsed ? null : <Icon name={reportsOpen ? 'expand_less' : 'expand_more'} className="text-[18px]" />}
          </button>
          {reportsOpen && !collapsed ? <div className="ml-5 space-y-0.5 border-l border-white/15 py-1 pl-2">{REPORT_ITEMS.map((item) => <WorkspaceNavLink key={item.label} item={item} pathname={pathname} collapsed={false} needsReply={needsReply} />)}</div> : null}
        </div>
        <div className="mt-3 space-y-1 border-t border-white/10 pt-3">{OPERATING_ITEMS.map((item) => <WorkspaceNavLink key={item.label} item={item} pathname={pathname} collapsed={collapsed} needsReply={needsReply} />)}</div>
      </nav>
      <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} className={cn('m-4 flex items-center gap-2 border-t border-white/10 pt-4 text-xs font-semibold text-[var(--crm-nav-muted)] hover:text-[var(--crm-nav-text)]', collapsed && 'justify-center')}><Icon name={collapsed ? 'chevron_right' : 'chevron_left'} />{collapsed ? <span className="sr-only">Expand</span> : 'Collapse'}</button>
    </aside>
  )
}
