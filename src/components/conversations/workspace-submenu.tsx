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

/** A portalled disclosure stays visible outside the scrolling/collapsed rail. */
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
    if (rect) setPosition({ left: Math.min(rect.right + 4, window.innerWidth - 260), top: Math.max(8, Math.min(rect.top, window.innerHeight - (items.length * 64 + 56))) })
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!position) return
    function outside(event: PointerEvent) {
      const target = event.target as Node
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) setPosition(null)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setPosition(null); toggle.current?.focus() }
    }
    const close = () => setPosition(null)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    const closeOnScroll = (event: Event) => { if (event.target !== panel.current) close() }
    document.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [position])
  if (!items) return children
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
      <Icon name="chevron_right" className="text-base" />
    </button>
    {position && createPortal(<div ref={panel} id={id} aria-label={`${label} sections`} role="navigation"
      onPointerEnter={cancelClose} onPointerLeave={closeSoon}
      onFocus={cancelClose} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) closeSoon() }}
      className="fixed z-[100] w-64 max-h-[80dvh] overflow-y-auto rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-2 text-[var(--crm-text)] shadow-xl"
      style={position}>
      <p className="px-3 py-2 text-xs font-bold text-[var(--crm-text-muted)]">{label}</p>
      {items.map((item) => item.href ? <Link key={item.label} href={item.href} prefetch={false} onClick={() => setPosition(null)}
        aria-current={pathname === item.href.split('?')[0] && Array.from(new URLSearchParams(item.href.split('?')[1] ?? '')).every(([key, value]) => search.get(key) === value) ? 'page' : undefined}
        className="block rounded-lg px-3 py-2.5 text-sm hover:bg-[var(--crm-surface-subtle)] focus-visible:outline-2 focus-visible:outline-[var(--crm-brand)] aria-[current=page]:bg-[var(--crm-brand-soft)] aria-[current=page]:text-[var(--crm-brand)]">
        <span className="font-semibold">{item.label}</span>{item.description && <span className="mt-0.5 block text-xs text-[var(--crm-text-muted)]">{item.description}</span>}
      </Link> : <div key={item.label} aria-disabled="true" className="px-3 py-2.5 text-sm text-[var(--crm-text-muted)]"><span className="font-semibold">{item.label}</span><span className="mt-0.5 block text-xs">{item.description}</span></div>)}
    </div>, portalHost ?? document.body)}
  </div>
}
