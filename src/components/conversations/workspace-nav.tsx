'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { SystemAndon } from '@/components/feedback/system-andon'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { isCaseyCrmUser } from '@/lib/telephony/agent-identity'

type NavItem = { label: string; icon: string; href: string; activeOn: string[] }

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: 'home', href: '/dashboard', activeOn: ['/dashboard'] },
  { label: 'Issue Log', icon: 'warning_amber', href: '/reports/andon', activeOn: ['/reports/andon', '/reports/bottlenecks'] },
  { label: 'Pipeline', icon: 'account_tree', href: '/contacts?list=contacted', activeOn: ['/contacts', '/leads', '/opportunities', '/in-closing'] },
  { label: 'Prospecting', icon: 'campaign', href: '/prospecting', activeOn: ['/prospecting', '/dialer'] },
  { label: 'Conversations', icon: 'forum', href: '/conversations', activeOn: ['/conversations'] },
  { label: 'Calendar', icon: 'calendar_month', href: '/calendar?department=acquisitions', activeOn: ['/calendar'] },
  { label: 'Scorecard', icon: 'fact_check', href: '/scorecard', activeOn: ['/scorecard'] },
  { label: 'Task', icon: 'checklist', href: '/tasks', activeOn: ['/tasks'] },
  { label: 'Reports', icon: 'bar_chart', href: '/reports/acquisitions', activeOn: ['/reports/acquisitions', '/reports/dispositions', '/reports/marketing', '/reports/finance', '/reports/call-sms'] },
  { label: 'Settings', icon: 'settings', href: '/settings', activeOn: ['/settings'] },
]

const CASEY_NAV_ITEMS: NavItem[] = [
  { label: 'My Day', icon: 'today', href: '/my-day', activeOn: ['/my-day'] },
  { label: 'Daily Rhythm', icon: 'routine', href: '/checklist', activeOn: ['/checklist'] },
  ...NAV_ITEMS.filter((item) => ['Pipeline', 'Prospecting', 'Conversations', 'Calendar', 'Task', 'Settings'].includes(item.label)),
]

const WARM_NAV_LABELS = new Set(['Dashboard', 'My Day', 'Pipeline', 'Prospecting', 'Conversations', 'Task'])

function workspaceItemsFor(userEmail?: string | null, canReviewCalls = false) {
  const isCasey = isCaseyCrmUser(userEmail)
  const baseNavItems = isCasey ? CASEY_NAV_ITEMS : NAV_ITEMS
  return isCasey || !canReviewCalls
    ? baseNavItems.filter((item) => item.label !== 'Scorecard')
    : baseNavItems
}

export function workspaceLabelForPath(pathname: string) {
  const matched = [...CASEY_NAV_ITEMS, ...NAV_ITEMS].find((item) => isItemActive(item, pathname))
  return matched?.label || 'Saving KC'
}

function isItemActive(item: NavItem, pathname: string) {
  return item.activeOn.some((prefix) => pathname.startsWith(prefix))
}

function WorkspaceNavLink({ item, pathname, collapsed, needsReply }: { item: NavItem; pathname: string; collapsed: boolean; needsReply: number | null }) {
  const active = isItemActive(item, pathname)
  const router = useRouter()
  return (
    <Link
      href={item.href}
      prefetch={WARM_NAV_LABELS.has(item.label) ? null : false}
      onPointerEnter={() => router.prefetch(item.href)}
      onFocus={() => router.prefetch(item.href)}
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
      {item.label === 'Conversations' && needsReply !== null && needsReply > 0 ? <span className="rounded-full bg-[var(--crm-brand)] px-1.5 py-0.5 text-[9px] font-black text-white">{needsReply}</span> : null}
    </Link>
  )
}

export function WorkspaceNav({ needsReply, userEmail, canReviewCalls = false }: { needsReply: number | null; userEmail?: string | null; canReviewCalls?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const isCasey = isCaseyCrmUser(userEmail)
  // Casey's agent workspace has a fixed, approved menu. Reviewer permissions
  // belong to the signed-in person and must not leak Scorecard into Casey's view.
  const navItems = workspaceItemsFor(userEmail, canReviewCalls)

  return (
    <aside className={cn('hidden shrink-0 flex-col border-r border-black/15 bg-[var(--crm-nav)] text-[var(--crm-nav-text)] transition-[width] duration-200 lg:flex', collapsed ? 'w-[64px]' : 'w-[192px]')}>
      <svg width="0" height="0" aria-hidden="true"><filter id="crm-logo-dark" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 -0.5 -0.5 0 1 -1 0 0 0 1 -1 0 0 0 1 0 0 0 1 0" /></filter></svg>
      <Link href={isCasey ? '/my-day' : '/dashboard'} prefetch onPointerEnter={() => router.prefetch(isCasey ? '/my-day' : '/dashboard')} onFocus={() => router.prefetch(isCasey ? '/my-day' : '/dashboard')} aria-label="Saving KC CRM dashboard" className={cn('flex h-[68px] items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-4')}>
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

export function WorkspaceMobileNav({ needsReply, userEmail, canReviewCalls = false }: { needsReply: number | null; userEmail?: string | null; canReviewCalls?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const navItems = workspaceItemsFor(userEmail, canReviewCalls)
  const primaryLabels = isCaseyCrmUser(userEmail)
    ? ['My Day', 'Pipeline', 'Prospecting', 'Conversations']
    : ['Dashboard', 'Pipeline', 'Prospecting', 'Conversations']
  const primaryItems = primaryLabels.flatMap((label) => navItems.filter((item) => item.label === label))
  const moreItems = navItems.filter((item) => !primaryLabels.includes(item.label))

  useEffect(() => {
    if (!moreOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [moreOpen])

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-[70] lg:hidden" role="presentation">
          <button type="button" className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" onClick={() => setMoreOpen(false)} aria-label="Close navigation" />
          <section role="dialog" aria-modal="true" aria-label="More navigation" className="crm-panel-raised absolute inset-x-0 bottom-0 max-h-[min(78dvh,42rem)] overflow-hidden rounded-t-3xl pb-[env(safe-area-inset-bottom)] shadow-2xl">
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-[var(--crm-border-strong)]" />
            <div className="flex items-center justify-between border-b border-[var(--crm-border)] px-5 py-4">
              <div><p className="crm-eyebrow">Workspace</p><h2 className="text-lg font-black text-[var(--crm-ink)]">More</h2></div>
              <button type="button" onClick={() => setMoreOpen(false)} className="crm-icon-button grid h-11 w-11 place-items-center rounded-xl" aria-label="Close navigation"><Icon name="close" /></button>
            </div>
            <nav className="grid max-h-[calc(78dvh-6rem)] grid-cols-2 gap-2 overflow-y-auto p-4" aria-label="Additional CRM navigation">
              {moreItems.map((item) => {
                const active = isItemActive(item, pathname)
                return <Link key={item.label} href={item.href} prefetch={false} onPointerDown={() => router.prefetch(item.href)} onClick={() => setMoreOpen(false)} aria-current={active ? 'page' : undefined} className={cn('flex min-h-14 items-center gap-3 rounded-xl border px-3 py-3 text-sm font-bold', active ? 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface)] text-[var(--crm-text)]')}><Icon name={item.icon} className="text-[21px]" />{item.label}</Link>
              })}
            </nav>
          </section>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-[60] grid h-[calc(4.25rem+env(safe-area-inset-bottom))] grid-cols-5 border-t border-[var(--crm-border)] bg-[color:var(--crm-surface)]/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(0,0,0,.12)] backdrop-blur-xl lg:hidden" aria-label="Primary CRM navigation">
        {primaryItems.map((item) => {
          const active = isItemActive(item, pathname)
          return <Link key={item.label} href={item.href} aria-current={active ? 'page' : undefined} className={cn('relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-bold', active ? 'text-[var(--crm-brand)]' : 'text-[var(--crm-text-muted)]')}><Icon name={item.icon} className="text-[22px]" /><span className="max-w-full truncate">{item.label}</span>{item.label === 'Conversations' && needsReply !== null && needsReply > 0 ? <span className="absolute right-[18%] top-1.5 min-w-4 rounded-full bg-[var(--crm-brand)] px-1 text-center text-[9px] text-white">{needsReply > 99 ? '99+' : needsReply}</span> : null}</Link>
        })}
        <button type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen} className="flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-bold text-[var(--crm-text-muted)]"><Icon name="menu" className="text-[22px]" /><span>More</span></button>
      </nav>
    </>
  )
}
