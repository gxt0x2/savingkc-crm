'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type ContextItem = {
  label: string
  href: string
  icon: string
  matchPath?: string
  section?: string
}

type ContextGroup = {
  label: string
  pathPrefix: string
  items: ContextItem[]
}

const DASHBOARD_CONTEXT_ITEMS: ContextItem[] = [
  { label: 'Company overview', href: '/dashboard', icon: 'space_dashboard', matchPath: '/dashboard' },
  { label: 'Acquisitions', href: '/reports/acquisitions', icon: 'track_changes', matchPath: '/reports/acquisitions' },
  { label: 'Dispositions', href: '/reports/dispositions', icon: 'sell', matchPath: '/reports/dispositions' },
  { label: 'Marketing', href: '/marketing', icon: 'campaign', matchPath: '/marketing' },
]

const GROUPS: ContextGroup[] = [
  {
    label: 'Dashboards',
    pathPrefix: '/dashboard',
    items: DASHBOARD_CONTEXT_ITEMS,
  },
  {
    label: 'Dashboards',
    pathPrefix: '/reports/acquisitions',
    items: DASHBOARD_CONTEXT_ITEMS,
  },
  {
    label: 'Dashboards',
    pathPrefix: '/reports/dispositions',
    items: DASHBOARD_CONTEXT_ITEMS,
  },
  {
    label: 'Dashboards',
    pathPrefix: '/reports/marketing',
    items: DASHBOARD_CONTEXT_ITEMS,
  },
  {
    label: 'Dashboards',
    pathPrefix: '/reports/andon',
    items: DASHBOARD_CONTEXT_ITEMS,
  },
  {
    label: 'Workflows',
    pathPrefix: '/workflows',
    items: [
      { label: 'Overview', href: '/workflows', icon: 'space_dashboard', section: 'overview' },
      { label: 'Phone system', href: '/workflows?section=phones', icon: 'account_tree', section: 'phones' },
      { label: 'All workflows', href: '/workflows?section=all', icon: 'schema', section: 'all' },
      { label: 'Email templates', href: '/workflows?section=templates', icon: 'mark_email_read', section: 'templates' },
    ],
  },
  {
    label: 'Dialer',
    pathPrefix: '/dialer',
    items: [
      { label: 'Overview', href: '/dialer', icon: 'space_dashboard', section: 'overview' },
      { label: 'Call queue', href: '/dialer?section=queue', icon: 'format_list_numbered', section: 'queue' },
      { label: 'Sessions', href: '/dialer?section=sessions', icon: 'play_circle', section: 'sessions' },
      { label: 'Conversations', href: '/dialer?section=conversations', icon: 'forum', section: 'conversations' },
      { label: 'Analytics', href: '/dialer?section=analytics', icon: 'monitoring', section: 'analytics' },
      { label: 'Settings', href: '/dialer?section=settings', icon: 'tune', section: 'settings' },
    ],
  },
  {
    label: 'Marketing',
    pathPrefix: '/marketing',
    items: [
      { label: 'Google Ads', href: '/marketing', icon: 'space_dashboard', matchPath: '/marketing' },
      { label: 'Call recordings', href: '/marketing/calls', icon: 'record_voice_over', matchPath: '/marketing/calls' },
      { label: 'Lead alerts', href: '/marketing/alerts', icon: 'notification_important', matchPath: '/marketing/alerts' },
      { label: 'Landing pages', href: '/marketing/heatmaps', icon: 'ads_click', matchPath: '/marketing/heatmaps' },
    ],
  },
  {
    label: 'Dispositions',
    pathPrefix: '/dispo',
    items: [
      { label: 'Dashboard', href: '/reports/dispositions', icon: 'space_dashboard', matchPath: '/reports/dispositions' },
      { label: 'Pipeline', href: '/dispo/pipeline', icon: 'route', matchPath: '/dispo/pipeline' },
      { label: 'Offers', href: '/dispo/offers', icon: 'local_offer', matchPath: '/dispo/offers' },
      { label: 'Buyers', href: '/dispo/buyers', icon: 'groups', matchPath: '/dispo/buyers' },
      { label: 'Deal pages', href: '/dispo/deals', icon: 'storefront', matchPath: '/dispo/deals' },
      { label: 'Marketing', href: '/dispo/broadcasts', icon: 'campaign', matchPath: '/dispo/broadcasts' },
      { label: 'Closing', href: '/dispo/tc', icon: 'fact_check', matchPath: '/dispo/tc' },
      { label: 'Partners', href: '/dispo/vendors', icon: 'handshake', matchPath: '/dispo/vendors' },
      { label: 'Contacts', href: '/dispo/contacts', icon: 'contact_page', matchPath: '/dispo/contacts' },
    ],
  },
  {
    label: 'Reports',
    pathPrefix: '/reports',
    items: [
      { label: 'Marketing', href: '/reports/marketing', icon: 'campaign', matchPath: '/reports/marketing' },
      { label: 'Finance', href: '/reports/finance', icon: 'account_balance', matchPath: '/reports/finance' },
      { label: 'Call/SMS', href: '/reports/call-sms', icon: 'phone_in_talk', matchPath: '/reports/call-sms' },
    ],
  },
]

export function WorkspaceContextNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // The Google Ads command center is the Marketing department dashboard. Its
  // child tools keep their own Marketing sub-navigation, while the root route
  // remains part of the same dashboard switcher as Company, Acquisitions, and
  // Dispositions.
  const group = pathname === '/marketing'
    ? { label: 'Dashboards', pathPrefix: '/marketing', items: DASHBOARD_CONTEXT_ITEMS }
    : GROUPS.find((candidate) => pathname.startsWith(candidate.pathPrefix))

  if (!group) return null

  const selectedSection = group.pathPrefix === '/dialer' || group.pathPrefix === '/workflows'
    ? searchParams.get('section') || 'overview'
    : searchParams.get('view') || ''

  return (
    <div className="shrink-0 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 sm:px-6">
      <div className="mx-auto flex h-12 max-w-[1440px] items-center gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="hidden shrink-0 items-center gap-2 border-r border-[var(--crm-border)] pr-4 text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)] sm:flex">
          <span className="h-2 w-2 rounded-full bg-[var(--crm-brand)]" />
          {group.label}
        </div>
        <nav aria-label={`${group.label} sections`} className="flex min-w-max items-center gap-1">
          {group.items.map((item) => {
            const active = item.section
              ? pathname === group.pathPrefix && selectedSection === item.section
              : item.matchPath === pathname || (item.matchPath !== group.pathPrefix && pathname.startsWith(`${item.matchPath}/`))

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-bold transition-colors',
                  active
                    ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
                    : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)] hover:text-[var(--crm-ink)]',
                )}
              >
                <Icon name={item.icon} className="text-[17px]" />
                {item.label}
                {active ? <span className="absolute inset-x-3 -bottom-1 h-0.5 rounded-full bg-[var(--crm-brand)]" /> : null}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
