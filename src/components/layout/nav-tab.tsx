'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/icon'

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

  function isActive(href: string): boolean {
    if (pathname === href) return true
    if (href === '/ari' && pathname?.startsWith('/ari')) return true
    if (href === '/opportunities' && (pathname?.startsWith('/opportunities') || pathname?.startsWith('/leads'))) return true
    if (href === '/dashboard' && pathname?.startsWith('/dashboard')) return true
    if (href === '/calendar' && pathname?.startsWith('/calendar')) return true
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
