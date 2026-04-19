'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const tabs = [
  { label: 'ARI', href: '/ari', icon: 'assistant' },
  { label: 'Hot Opps', href: '/opportunities', icon: 'local_fire_department' },
  { label: 'KPIs', href: '/dashboard', icon: 'insights' },
  { label: 'Calendar', href: '/calendar', icon: 'calendar_today' },
]

interface NavTabsProps {
  onNavigate?: () => void
  mobile?: boolean
}

export function NavTabs({ onNavigate, mobile }: NavTabsProps) {
  const pathname = usePathname()

  if (mobile) {
    return (
      <nav className="flex flex-col gap-1">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.href === '/leads' && pathname?.startsWith('/leads')) ||
            (tab.href === '/pipeline' && pathname === '/pipeline')

          return (
            <Link
              key={tab.label}
              href={tab.href}
              prefetch={false}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <span className="material-symbols-outlined text-xl">{tab.icon}</span>
              {tab.label}
            </Link>
          )
        })}
      </nav>
    )
  }

  return (
    <nav className="flex items-center h-16">
      {tabs.map((tab) => {
        const active =
          pathname === tab.href ||
          (tab.href === '/leads' && pathname?.startsWith('/leads')) ||
          (tab.href === '/pipeline' && pathname === '/pipeline')

        return (
          <Link
            key={tab.label}
            href={tab.href}
            prefetch={false}
            onClick={onNavigate}
            className={cn(
              'relative px-3 py-3 text-sm font-semibold transition-all border-b-2 whitespace-nowrap',
              active
                ? 'text-primary border-primary font-bold'
                : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
