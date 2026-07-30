'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const items = [
  { label: 'Conversations', icon: 'forum', href: '/conversations', activeOn: ['/conversations'], accent: '#ff5f68', iconTone: 'text-[#ff5f68]', activeBg: 'bg-[#d92636]/24' },
  { label: 'Opportunities', icon: 'paid', href: '/opportunities', activeOn: ['/opportunities', '/leads'], accent: '#f2ae3a', iconTone: 'text-[#f2ae3a]', activeBg: 'bg-[#c77700]/24' },
  { label: 'Contacts', icon: 'group', href: '/contacts', activeOn: ['/contacts'], accent: '#72a7ff', iconTone: 'text-[#72a7ff]', activeBg: 'bg-[#2868d7]/24' },
  { label: 'Calendar & Tasks', icon: 'calendar_month', href: '/calendar?department=acquisitions', activeOn: ['/calendar'], accent: '#b29af7', iconTone: 'text-[#b29af7]', activeBg: 'bg-[#7357c7]/24' },
  { label: 'Workflows', icon: 'account_tree', href: '/workflows', activeOn: ['/workflows'], accent: '#55cbb8', iconTone: 'text-[#55cbb8]', activeBg: 'bg-[#087f70]/24' },
  { label: 'Marketing', icon: 'campaign', href: '/marketing', activeOn: ['/marketing'], accent: '#ff9275', iconTone: 'text-[#ff9275]', activeBg: 'bg-[#e76f51]/24' },
  { label: 'Dispositions', icon: 'sell', href: '/dispo/pipeline', activeOn: ['/dispo'], accent: '#f4c15d', iconTone: 'text-[#f4c15d]', activeBg: 'bg-[#c68a14]/24' },
  { label: 'Reports', icon: 'bar_chart', href: '/dashboard', activeOn: ['/dashboard'], accent: '#6bc6df', iconTone: 'text-[#6bc6df]', activeBg: 'bg-[#2183a2]/24' },
  { label: 'Settings', icon: 'settings', href: '/settings', activeOn: ['/settings'], accent: '#b4bec8', iconTone: 'text-[#b4bec8]', activeBg: 'bg-white/10' },
]

export function WorkspaceNav({ needsReply }: { needsReply: number }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  return (
    <aside className={cn('hidden shrink-0 flex-col bg-[linear-gradient(180deg,#081f34_0%,#0c293f_48%,#15171b_100%)] text-white shadow-[8px_0_28px_rgba(7,26,43,0.12)] transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-[230px]')}>
      <svg width="0" height="0" aria-hidden="true">
        <filter id="crm-logo-dark" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0 -0.5 -0.5 0 1
                    -1 0 0 0 1
                    -1 0 0 0 1
                    0 0 0 1 0"
          />
        </filter>
      </svg>
      <Link href="/conversations" aria-label="Saving KC CRM home" className={cn('flex h-[82px] items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-5')}>
        {collapsed ? <Image
          src="/logo.png"
          alt=""
          width={489}
          height={141}
          className="h-auto w-[58px] object-contain"
          style={{ filter: 'url(#crm-logo-dark)' }}
        /> : <Image
          src="/logo.png"
          alt="Saving KC Homebuyers"
          width={489}
          height={141}
          className="h-auto w-[155px] object-contain"
          style={{ filter: 'url(#crm-logo-dark)' }}
        />}
      </Link>
      <nav className="flex-1 space-y-1 px-3 py-5">
        {items.map((item, index) => {
          const active = item.activeOn.some((prefix) => pathname.startsWith(prefix))
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-3 text-[13px] font-semibold transition-colors',
                collapsed && 'justify-center',
                active
                  ? `${item.activeBg} text-white`
                  : 'text-white/72 hover:bg-white/8 hover:text-white',
                index === 4 && 'mt-5 border-t border-white/10 pt-5',
              )}
              style={active ? { boxShadow: `inset 3px 0 0 ${item.accent}, 0 7px 18px rgba(0,0,0,0.12)` } : undefined}
            >
              <Icon name={item.icon} className={cn('text-[20px]', active ? item.iconTone : 'text-white/70')} />
              <span className={cn('min-w-0 flex-1', collapsed && 'sr-only')}>{item.label}</span>
              {item.label === 'Conversations' && needsReply > 0 ? (
                <span className="rounded-full bg-[#df3038] px-2 py-0.5 text-[10px] font-black text-white">
                  {needsReply}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>
      <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} className={cn('m-4 flex items-center gap-2 border-t border-white/10 pt-4 text-xs font-semibold text-white/70 hover:text-white', collapsed && 'justify-center')}>
        <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} />
        {collapsed ? <span className="sr-only">Expand</span> : 'Collapse'}
      </button>
    </aside>
  )
}
