'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/icon'

type Section = { label: string; href?: string; description?: string }
export const WORKSPACE_SECTIONS: Record<string, Section[]> = {
  Prospecting: [
    { label: 'Dialer', href: '/prospecting', description: 'Prospecting dialer' },
    { label: 'Email', href: '/marketing/email', description: 'Email campaigns and replies' },
    { label: 'SMS', description: 'Text campaigns · not connected yet' },
  ],
  Pipeline: [
    { label: 'Leads', href: '/contacts?list=contacted' },
    { label: 'Opportunities', href: '/opportunities' },
    { label: 'In closing', href: '/in-closing' },
  ],
  Calendar: [
    { label: 'Calendar', href: '/calendar?department=acquisitions' },
    { label: 'Agenda', href: '/calendar?view=agenda' },
  ],
  Dispositions: [
    { label: 'Pipeline', href: '/dispo/pipeline' },
    { label: 'Offers', href: '/dispo/offers' },
    { label: 'Buyers', href: '/dispo/buyers' },
    { label: 'Deal pages', href: '/dispo/deals' },
    { label: 'Broadcasts', href: '/dispo/broadcasts' },
    { label: 'Closing', href: '/dispo/tc' },
    { label: 'Partners', href: '/dispo/vendors' },
  ],
  Reports: [
    { label: 'Acquisitions', href: '/reports/acquisitions' },
    { label: 'Dispositions', href: '/reports/dispositions' },
    { label: 'Marketing', href: '/reports/marketing' },
    { label: 'Google Ads', href: '/marketing/google-ads' },
    { label: 'Finance', href: '/reports/finance' },
    { label: 'Calls & SMS', href: '/reports/call-sms' },
  ],
}

/** Expanded rails show a nested tree; collapsed rails use a compact flyout. */
export function WorkspaceSubmenu({ label, collapsed, children }: {
  label: string; collapsed: boolean; children: ReactNode
}) {
  const pathname = usePathname()
  const search = useSearchParams()
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [portalHost, setPortalHost] = useState<Element | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const openedByHover = useRef(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const items = WORKSPACE_SECTIONS[label]
  const id = `workspace-submenu-${label.toLowerCase()}`
  const cancelClose = () => clearTimeout(timer.current)
  const closeSoon = () => { cancelClose(); timer.current = setTimeout(() => { if (!panel.current?.contains(document.activeElement)) setPosition(null) }, 160) }
  function open(fromHover = false) {
    cancelClose()
    if (fromHover && position) return
    openedByHover.current = fromHover
    setPortalHost(anchor.current?.closest('.crm-workspace-shell') ?? document.body)
    const rect = anchor.current?.getBoundingClientRect()
    if (rect) setPosition({ left: Math.min(rect.right + 4, window.innerWidth - 200), top: Math.max(8, Math.min(rect.top, window.innerHeight - (items.length * 36 + 16))) })
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!position) return
    function outside(event: MouseEvent) {
      const target = event.target as Node
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) setPosition(null)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setPosition(null); toggle.current?.focus() }
    }
    const close = () => setPosition(null)
    document.addEventListener('click', outside)
    document.addEventListener('keydown', escape)
    const closeOnScroll = (event: Event) => { if (collapsed && event.target !== panel.current) close() }
    document.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('click', outside)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [position, collapsed])
  if (!items) return children
  const submenu = <div ref={panel} id={id} aria-label={`${label} sections`} role="navigation"
      onPointerEnter={cancelClose} onPointerLeave={closeSoon}
      onFocus={cancelClose} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) closeSoon() }}
      className={collapsed ? "fixed z-[100] w-48 max-h-[80dvh] overflow-y-auto rounded-xl border border-[var(--crm-nav-hover)] bg-[var(--crm-nav)] p-2 text-[var(--crm-nav-text)] shadow-xl" : "ml-6 mt-1 mb-2 border-l border-[var(--crm-nav-hover)] pl-2 text-[var(--crm-nav-text)]"}
      style={collapsed && position ? position : undefined}>
      {items.map((item) => item.href ? <Link key={item.label} href={item.href} prefetch={false} onClick={() => setPosition(null)}
        aria-current={pathname === item.href.split('?')[0] && Array.from(new URLSearchParams(item.href.split('?')[1] ?? '')).every(([key, value]) => search.get(key) === value) ? 'page' : undefined}
        className="relative block rounded-lg px-3 py-2 text-xs text-[var(--crm-nav-muted)] before:absolute before:-left-2 before:top-1/2 before:h-px before:w-2 before:bg-[var(--crm-nav-hover)] hover:bg-[var(--crm-nav-hover)] hover:text-[var(--crm-nav-text)] focus-visible:outline-2 focus-visible:outline-[var(--crm-brand)] aria-[current=page]:bg-[var(--crm-nav-active)] aria-[current=page]:font-semibold aria-[current=page]:text-[var(--crm-nav-text)]">
        {item.label}
      </Link> : <div key={item.label} aria-disabled="true" title={item.description} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs text-[var(--crm-nav-muted)]"><span>{item.label}</span><span className="text-[10px]">Not connected</span></div>)}
    </div>
  return <div ref={anchor} className="relative" onPointerEnter={(event) => { if (event.pointerType !== 'touch') open(true) }} onPointerLeave={closeSoon}>
    <div className={collapsed ? '' : 'pr-7'}>{children}</div>
    <button ref={toggle} type="button" aria-label={`Open ${label} sections`} aria-expanded={Boolean(position)} aria-controls={id}
      onClick={() => position && !openedByHover.current ? setPosition(null) : open()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || (event.key === 'Tab' && position && !event.shiftKey)) {
          event.preventDefault(); open(); requestAnimationFrame(() => panel.current?.querySelector<HTMLAnchorElement>('a')?.focus())
        }
      }}
      className={`absolute right-0 top-0 grid ${collapsed ? 'h-4 w-4' : 'h-10 w-7'} place-items-center rounded text-[var(--crm-nav-muted)] hover:text-[var(--crm-nav-text)] focus-visible:outline-2 focus-visible:outline-[var(--crm-brand)]`}>
      <Icon name="chevron_right" className={`text-base transition-transform ${position && !collapsed ? 'rotate-90' : ''}`} />
    </button>
    {position && (collapsed ? createPortal(submenu, portalHost ?? document.body) : submenu)}
  </div>
}
