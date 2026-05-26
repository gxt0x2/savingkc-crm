'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import type { AppMode } from '@/hooks/use-app-mode'

interface ModeSwitcherProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

const PORTALS: Array<{
  mode: AppMode
  label: string
  shortLabel?: string
  caption: string
  description: string
  icon: 'home' | 'deal' | 'tc'
}> = [
  {
    mode: 'acquisitions',
    label: 'Acquisitions',
    caption: 'Seller pipeline',
    description: 'Leads, ARI, dialer, tasks, and KPIs.',
    icon: 'home',
  },
  {
    mode: 'dispositions',
    label: 'Dispositions',
    caption: 'Buyer pipeline',
    description: 'Deal pages, buyers, broadcasts, offers, and contacts.',
    icon: 'deal',
  },
  {
    mode: 'tc',
    label: 'Transaction Coordination',
    shortLabel: 'TC Portal',
    caption: 'Reports to Dispositions',
    description: 'Closing files, drafts, calls, exceptions, and title work.',
    icon: 'tc',
  },
]

type MenuPosition = {
  left: number
  top: number
  width: number
}

function PortalIcon({ icon }: { icon: 'home' | 'deal' | 'tc' }) {
  if (icon === 'home') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none">
        <path d="M4 10.75 12 4l8 6.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.5 9.75V20h11V9.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.75 20v-5.5h4.5V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (icon === 'deal') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none">
        <path d="M7.5 12.5 10 15a2.1 2.1 0 0 0 3 0l4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m8 9 1.75-1.75a3 3 0 0 1 4.25 0L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.5 12.5 7 16a3 3 0 0 0 4.25 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20.5 12.5 17 16a3 3 0 0 1-4.25 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none">
      <rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="m9 12 2 2 4-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 7.5h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 text-[#E32E2E]" aria-hidden="true" fill="none">
      <path d="m4.5 10.5 3.25 3.25L15.5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-[var(--ck-text-muted)]" aria-hidden="true" fill="none">
      <path
        d={open ? 'm5 12 5-5 5 5' : 'm5 8 5 5 5-5'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ left: 0, top: 0, width: 340 })
  const [menuTheme, setMenuTheme] = useState<CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const active = PORTALS.find((portal) => portal.mode === mode) ?? PORTALS[0]
  const activeLabel = active.shortLabel ?? active.label

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return

    function updatePosition() {
      const trigger = triggerRef.current
      const rect = trigger?.getBoundingClientRect()
      if (!rect) return

      const gutter = 16
      const width = Math.min(340, window.innerWidth - gutter * 2)
      const left = Math.min(Math.max(rect.left, gutter), window.innerWidth - width - gutter)

      setMenuPosition({
        left,
        top: rect.bottom + 8,
        width,
      })

      if (trigger) {
        const computed = window.getComputedStyle(trigger)
        setMenuTheme({
          '--ck-surface': computed.getPropertyValue('--ck-surface') || '#ffffff',
          '--ck-surface-elev': computed.getPropertyValue('--ck-surface-elev') || '#f8fafc',
          '--ck-border': computed.getPropertyValue('--ck-border') || '#d8dee9',
          '--ck-text': computed.getPropertyValue('--ck-text') || '#111827',
          '--ck-text-muted': computed.getPropertyValue('--ck-text-muted') || '#4b5565',
        } as CSSProperties)
      }
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const menu = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      className="fixed overflow-hidden rounded-xl border py-1 shadow-2xl"
      style={{
        ...menuTheme,
        left: menuPosition.left,
        top: menuPosition.top,
        width: menuPosition.width,
        zIndex: 1000,
        background: 'var(--ck-surface, #ffffff)',
        borderColor: 'var(--ck-border, #d8dee9)',
        color: 'var(--ck-text, #111827)',
      }}
      role="menu"
      aria-label="Department options"
    >
      {PORTALS.map((portal) => (
        <button
          key={portal.mode}
          type="button"
          onClick={() => {
            onChange(portal.mode)
            setOpen(false)
          }}
          className={cn(
            'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[#E32E2E]/10',
            portal.mode === mode ? 'bg-[#E32E2E]/10' : ''
          )}
          role="menuitem"
        >
          <span className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
            portal.mode === mode ? 'border-[#E32E2E]/30 bg-[#E32E2E]/15 text-[#E32E2E]' : 'border-[var(--ck-border)] text-[var(--ck-text-muted)]'
          )}>
            <PortalIcon icon={portal.icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-[var(--ck-text)]">{portal.label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-[var(--ck-text-muted)]">{portal.description}</span>
          </span>
          {portal.mode === mode && <CheckIcon />}
        </button>
      ))}
    </div>,
    document.body
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-[190px] items-center justify-between gap-3 rounded-full border px-3 py-1.5 text-left transition-colors"
        style={{
          background: 'var(--ck-surface-elev)',
          borderColor: open ? 'var(--ck-accent)' : 'var(--ck-border)',
          color: 'var(--ck-text)',
          boxShadow: open ? '0 0 0 2px rgba(227, 46, 46, 0.12)' : undefined,
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-black leading-none">{activeLabel}</span>
          <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)]">{active.caption}</span>
        </span>
        <ChevronIcon open={open} />
      </button>
      {menu}
    </>
  )
}
