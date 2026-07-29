'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const items = [
  { label: 'Conversations', icon: 'forum', href: '/conversations', activeOn: ['/conversations'] },
  { label: 'Opportunities', icon: 'paid', href: '/opportunities', activeOn: ['/opportunities', '/leads'] },
  { label: 'Contacts', icon: 'group', href: '/contacts', activeOn: ['/contacts'] },
  { label: 'Calendar & Tasks', icon: 'calendar_month', href: '/calendar?department=acquisitions', activeOn: ['/calendar'] },
  { label: 'Workflows', icon: 'account_tree', href: '/workflows', activeOn: ['/workflows'] },
  { label: 'Marketing', icon: 'campaign', href: '/marketing', activeOn: ['/marketing'] },
  { label: 'Dispositions', icon: 'sell', href: '/dispo/pipeline', activeOn: ['/dispo'] },
  { label: 'Reports', icon: 'bar_chart', href: '/dashboard', activeOn: ['/dashboard'] },
  { label: 'Settings', icon: 'settings', href: '/settings', activeOn: ['/settings'] },
]

export function WorkspaceNav({ needsReply }: { needsReply: number }) {
  const pathname = usePathname()
  return (
    <aside className="hidden w-[230px] shrink-0 flex-col bg-[#15171b] text-white lg:flex">
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
      <Link href="/contacts" className="flex h-[82px] items-center border-b border-white/10 px-5">
        <Image
          src="/logo.png"
          alt="Saving KC Homebuyers"
          width={489}
          height={141}
          className="h-auto w-[155px] object-contain"
          style={{ filter: 'url(#crm-logo-dark)' }}
        />
      </Link>
      <nav className="flex-1 space-y-1 px-3 py-5">
        {items.map((item, index) => {
          const active = item.activeOn.some((prefix) => pathname.startsWith(prefix))
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-3 text-[13px] font-semibold transition-colors',
                active
                  ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#df3038]'
                  : 'text-white/72 hover:bg-white/8 hover:text-white',
                index === 4 && 'mt-5 border-t border-white/10 pt-5',
              )}
            >
              <Icon name={item.icon} className={cn('text-[20px]', active ? 'text-white' : 'text-white/70')} />
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.label === 'Conversations' && needsReply > 0 ? (
                <span className="rounded-full bg-[#df3038] px-2 py-0.5 text-[10px] font-black text-white">
                  {needsReply}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>
      <button className="m-4 flex items-center gap-2 border-t border-white/10 pt-4 text-xs font-semibold text-white/70">
        <Icon name="chevron_left" />
        Collapse
      </button>
    </aside>
  )
}
