'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAppMode } from '@/hooks/use-app-mode'

const acquisitionTabs = [
  { label: 'ARI', href: '/ari', icon: 'assistant' },
  { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
  { label: 'Opportunities', href: '/opportunities', icon: 'star' },
  { label: 'Leads', href: '/leads', icon: 'people' },
  { label: 'Conversations', href: '/conversations', icon: 'forum' },
  { label: 'Calendar', href: '/calendar', icon: 'calendar_today' },
  { label: 'Pipeline', href: '/pipeline', icon: 'view_kanban' },
]

const dispoTabs = [
  { label: 'Buyers', href: '/dispo/buyers', icon: 'group' },
  { label: 'Broadcasts', href: '/dispo/broadcasts', icon: 'campaign' },
  { label: 'Deal Pages', href: '/dispo/deals', icon: 'description' },
  { label: 'Offers', href: '/dispo/offers', icon: 'local_offer' },
]

interface NavTabsProps {
  onNavigate?: () => void
  mobile?: boolean
}

export function NavTabs({ onNavigate, mobile }: NavTabsProps) {
  const pathname = usePathname()
  const { mode } = useAppMode()
  const tabs = mode === 'dispositions' ? dispoTabs : acquisitionTabs

  function isActive(tab: { href: string }) {
    if (pathname === tab.href) return true
    if (tab.href === '/leads' && pathname?.startsWith('/leads')) return true
    if (tab.href === '/pipeline' && pathname === '/pipeline') return true
    if (tab.href === '/dispo/buyers' && pathname?.startsWith('/dispo/buyers')) return true
    if (tab.href === '/dispo/broadcasts' && pathname?.startsWith('/dispo/broadcasts')) return true
    if (tab.href === '/dispo/deals' && pathname?.startsWith('/dispo/deals')) return true
    if (tab.href === '/dispo/offers' && pathname?.startsWith('/dispo/offers')) return true
    return false
  }

  if (mobile) {
    return (
      <nav className="flex flex-col gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            prefetch={false}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all',
              isActive(tab)
                ? 'bg-primary/10 text-primary'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            <span className="material-symbols-outlined text-xl">{tab.icon}</span>
            {tab.label}
          </Link>
        ))}
      </nav>
    )
  }

  return (
    <nav className="flex items-center h-16">
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          prefetch={false}
          onClick={onNavigate}
          className={cn(
            'relative px-3 py-3 text-sm font-semibold transition-all border-b-2 whitespace-nowrap',
            isActive(tab)
              ? 'text-primary border-primary font-bold'
              : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
