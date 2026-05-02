'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import type { AppMode } from '@/hooks/use-app-mode'

interface ModeSwitcherProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = PORTALS.find((portal) => portal.mode === mode) ?? PORTALS[0]
  const activeLabel = active.shortLabel ?? active.label

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-[190px] items-center justify-between gap-3 rounded-full border px-3 py-1.5 text-left transition-colors"
        style={{
          background: 'var(--ck-surface-elev)',
          borderColor: 'var(--ck-border)',
          color: 'var(--ck-text)',
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
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border py-1 shadow-2xl"
          style={{
            background: 'var(--ck-surface)',
            borderColor: 'var(--ck-border)',
          }}
          role="menu"
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
        </div>
      )}
    </div>
  )
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
