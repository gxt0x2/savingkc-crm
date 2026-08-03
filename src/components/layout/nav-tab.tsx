'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAppMode } from '@/hooks/use-app-mode'

const acquisitionTabs = [
  { label: 'ARI', href: '/ari', icon: 'assistant' },
  { label: 'Contacts', href: '/contacts', icon: 'contacts' },
  { label: 'Conversations', href: '/conversations', icon: 'forum' },
  { label: 'Workflows', href: '/workflows', icon: 'account_tree' },
  { label: 'Calendar', href: '/calendar?department=acquisitions', icon: 'calendar_today' },
  { label: 'Dialer', href: '/dialer', icon: 'phone_in_talk' },
  { label: 'Ads', href: '/marketing', icon: 'monitoring' },
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
  { label: 'Files', href: '/dispo/tc', icon: 'fact_check' },
  { label: 'Communications', href: '/dispo/tc?view=communications', icon: 'forum' },
  { label: 'Doc Review', href: '/dispo/tc?view=docs', icon: 'preview' },
  { label: 'Tasks', href: '/dispo/tc?view=tasks', icon: 'task_alt' },
  { label: 'Calendar', href: '/calendar?department=tc', icon: 'calendar_today' },
  { label: 'Dispo Reports', href: '/dispo/tc?view=reports', icon: 'account_tree' },
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
      const tabView = new URLSearchParams(href.split('?')[1] ?? '').get('view')
      const currentView = searchParams.get('view')
      return (pathname?.startsWith('/dispo/tc') ?? false) && (tabView ? currentView === tabView : !currentView)
    }
    if (!href.includes('?') && pathname === baseHref) return true
    if (href === '/ari' && pathname?.startsWith('/ari')) return true
    if (href === '/contacts' && (
      pathname?.startsWith('/contacts') ||
      pathname?.startsWith('/opportunities') ||
      pathname?.startsWith('/in-closing') ||
      pathname?.startsWith('/leads')
    )) return true
    if (href === '/workflows' && pathname?.startsWith('/workflows')) return true
    if (href === '/conversations' && pathname?.startsWith('/conversations')) return true
    if (href === '/dialer' && pathname?.startsWith('/dialer')) return true
    if (href === '/marketing' && pathname?.startsWith('/marketing')) return true
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
              {tab.label}
            </Link>
          )
        })}
      </nav>
    )
  }

  return (
    <nav className="flex items-center gap-0.5 h-16 overflow-x-auto scrollbar-hide max-w-full">
      {tabs.map((tab) => {
        const active = isActive(tab.href)
        return (
          <Link
            key={tab.label}
            href={tab.href}
            prefetch={false}
            onClick={onNavigate}
            className={`relative flex items-center gap-1.5 px-2.5 py-2 text-sm font-bold rounded-lg transition-colors whitespace-nowrap flex-shrink-0 ${
              active
                ? `bg-[#E32E2E]/15 ${activeText}`
                : inactiveText
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
