'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
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
  icon: string
}> = [
  {
    mode: 'acquisitions',
    label: 'Acquisitions',
    caption: 'Seller pipeline',
    description: 'Leads, ARI, dialer, tasks, and KPIs.',
    icon: 'home_work',
  },
  {
    mode: 'dispositions',
    label: 'Dispositions',
    caption: 'Buyer pipeline',
    description: 'Deal pages, buyers, broadcasts, offers, and contacts.',
    icon: 'handshake',
  },
  {
    mode: 'tc',
    label: 'Transaction Coordination',
    shortLabel: 'TC Portal',
    caption: 'Reports to Dispositions',
    description: 'Closing files, drafts, calls, exceptions, and title work.',
    icon: 'assignment_turned_in',
  },
]

type MenuPosition = {
  left: number
  top: number
  width: number
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
            <Icon name={portal.icon} size="text-lg" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-[var(--ck-text)]">{portal.label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-[var(--ck-text-muted)]">{portal.description}</span>
          </span>
          {portal.mode === mode && <Icon name="check" size="text-base" className="text-[#E32E2E]" />}
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
        <Icon name={open ? 'expand_less' : 'expand_more'} size="text-lg" className="shrink-0 text-[var(--ck-text-muted)]" />
      </button>
      {menu}
    </>
  )
}
