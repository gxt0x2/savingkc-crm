'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { useAppMode } from '@/hooks/use-app-mode'

const acquisitionTabs = [
  { label: 'ARI', href: '/ari', icon: 'assistant' },
  { label: 'Hot Opps', href: '/opportunities', icon: 'local_fire_department' },
  { label: 'Calendar', href: '/calendar?department=acquisitions', icon: 'calendar_today' },
  { label: 'Dialer', href: '/dialer', icon: 'phone_in_talk' },
  { label: 'KPIs', href: '/dashboard', icon: 'insights' },
]

const dispoTabs = [
  { label: 'Tasks', href: '/calendar?view=agenda', icon: 'task_alt' },
  { label: 'Pipeline', href: '/dispo/pipeline', icon: 'route' },
  { label: 'Deal Pages', href: '/dispo/deals', icon: 'description' },
  { label: 'Contacts', href: '/dispo/contacts', icon: 'contacts' },
  { label: 'Buyers', href: '/dispo/buyers', icon: 'group' },
  { label: 'Broadcasts', href: '/dispo/broadcasts', icon: 'campaign' },
  { label: 'Offers', href: '/dispo/offers', icon: 'local_offer' },
  { label: 'Calendar', href: '/calendar?department=dispositions', icon: 'calendar_today' },
]

const tcTabs = [
  { label: 'Workspace', href: '/dispo/tc', icon: 'assignment_turned_in' },
  { label: 'Reports to Dispositions', href: '/dispo/pipeline', icon: 'account_tree' },
  { label: 'Calendar', href: '/calendar?department=tc', icon: 'calendar_today' },
]

interface NavTabsProps {
  onNavigate?: () => void
  mobile?: boolean
}

export function NavTabs({ onNavigate, mobile }: NavTabsProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { mode } = useAppMode()
  const tabs = mode === 'tc' ? tcTabs : mode === 'dispositions' ? dispoTabs : acquisitionTabs
  const isTcNav = mode === 'tc'
  const activeText = isTcNav ? 'text-[var(--ck-text)]' : 'text-white'
  const inactiveText = isTcNav
    ? 'text-[var(--ck-text-muted)] hover:bg-[#E32E2E]/15 hover:text-[var(--ck-text)]'
    : 'text-[var(--ck-text-muted)] hover:bg-[#E32E2E]/15 hover:text-white'

  function isActive(href: string): boolean {
    const baseHref = href.split('?')[0]
    if (baseHref === '/dispo/tc') {
      return pathname?.startsWith('/dispo/tc') ?? false
    }
    if (!href.includes('?') && pathname === baseHref) return true
    if (href === '/ari' && pathname?.startsWith('/ari')) return true
    if (href === '/opportunities' && (pathname?.startsWith('/opportunities') || pathname?.startsWith('/leads'))) return true
    if (href === '/dialer' && pathname?.startsWith('/dialer')) return true
    if (href === '/dashboard' && pathname?.startsWith('/dashboard')) return true
    if (href === '/calendar?view=agenda') return pathname?.startsWith('/calendar') && searchParams.get('view') === 'agenda'
    if (href.startsWith('/calendar')) {
      const tabDepartment = new URLSearchParams(href.split('?')[1] ?? '').get('department')
      const currentDepartment = searchParams.get('department') ?? mode
      return pathname?.startsWith('/calendar') && (!tabDepartment || currentDepartment === tabDepartment)
    }
    if (href === '/checklist' && pathname?.startsWith('/checklist')) return true
    if (href === '/dispo/pipeline' && pathname?.startsWith('/dispo/pipeline')) return true
    if (href === '/dispo/deals' && pathname?.startsWith('/dispo/deals')) return true
    if (href === '/dispo/offers' && pathname?.startsWith('/dispo/offers')) return true
    if (href === '/dispo/broadcasts' && pathname?.startsWith('/dispo/broadcasts')) return true
    if (baseHref === '/dispo/contacts' && (
      pathname?.startsWith('/dispo/contacts') ||
      pathname?.startsWith('/dispo/buyers') ||
      pathname?.startsWith('/dispo/vendors')
    )) return true
    if (href === '/dispo/buyers' && (pathname?.startsWith('/dispo/buyers') || pathname?.startsWith('/dispo/vendors'))) return true
    return false
  }

  if (mobile) {
    return (
      <nav className="flex flex-col gap-1">
        {tabs.map((tab) => {
          const active = isActive(tab.href)
          return (
            <Link
              key={tab.label}
              href={tab.href}
              prefetch={false}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors ${
                active
                  ? `bg-[#E32E2E]/15 ${activeText} border-l-2 border-[#E32E2E]`
                  : inactiveText
              }`}
            >
              <Icon
                name={tab.icon}
                size="text-xl"
                className={active ? 'text-[#E32E2E]' : 'text-[var(--ck-text-muted)]'}
              />
              {tab.label}
            </Link>
          )
        })}
      </nav>
    )
  }

  return (
    <nav className="flex items-center gap-1 h-16">
      {tabs.map((tab) => {
        const active = isActive(tab.href)
        return (
          <Link
            key={tab.label}
            href={tab.href}
            prefetch={false}
            onClick={onNavigate}
            className={`relative flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-lg transition-colors whitespace-nowrap ${
              active
                ? `bg-[#E32E2E]/15 ${activeText}`
                : inactiveText
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
  )
}
