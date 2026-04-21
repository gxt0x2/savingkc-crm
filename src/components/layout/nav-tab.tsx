'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { useAppMode } from '@/hooks/use-app-mode'

const acquisitionTabs = [
  { label: 'ARI', href: '/ari', icon: 'assistant' },
  { label: 'Hot Opps', href: '/opportunities', icon: 'local_fire_department' },
  { label: 'KPIs', href: '/dashboard', icon: 'insights' },
  { label: 'Calendar', href: '/calendar', icon: 'calendar_today' },
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

  function isActive(href: string): boolean {
    if (pathname === href) return true
    if (href === '/ari' && pathname?.startsWith('/ari')) return true
    if (href === '/opportunities' && (pathname?.startsWith('/opportunities') || pathname?.startsWith('/leads'))) return true
    if (href === '/dashboard' && pathname?.startsWith('/dashboard')) return true
    if (href === '/calendar' && pathname?.startsWith('/calendar')) return true
    if (href === '/dispo/buyers' && pathname?.startsWith('/dispo/buyers')) return true
    if (href === '/dispo/broadcasts' && pathname?.startsWith('/dispo/broadcasts')) return true
    if (href === '/dispo/deals' && pathname?.startsWith('/dispo/deals')) return true
    if (href === '/dispo/offers' && pathname?.startsWith('/dispo/offers')) return true
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
                  ? 'bg-[#E32E2E]/15 text-white border-l-2 border-[#E32E2E]'
                  : 'text-[var(--ck-text-muted)] hover:bg-white/5 hover:text-[var(--ck-text)]'
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
  )
}
