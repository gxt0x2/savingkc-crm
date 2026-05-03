'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import type { AppMode } from '@/hooks/use-app-mode'

interface ModeSwitcherProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

const portalOptions: Array<{
  key: AppMode
  label: string
  icon: string
  helper: string
}> = [
  { key: 'acquisitions', label: 'Acquisitions', icon: 'person_search', helper: 'Lead intake and dialer' },
  { key: 'dispositions', label: 'Dispositions', icon: 'real_estate_agent', helper: 'Pipeline, deal pages, offers' },
  { key: 'tc', label: 'TC', icon: 'fact_check', helper: 'Closings, title, EMD' },
]

export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const activeKey: AppMode = mode
  const active = portalOptions.find((option) => option.key === activeKey) ?? portalOptions[0]
  const isTcPortal = mode === 'tc'

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }

    if (open) document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function selectPortal(key: AppMode) {
    setOpen(false)
    onChange(key)
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--ck-text)] transition-colors',
          isTcPortal ? 'border border-[var(--ck-border)] hover:bg-[#fff1f1]' : 'hover:bg-white/5'
        )}
        style={{ background: 'var(--ck-surface-elev)' }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name={active.icon} size="text-sm" className="text-[#E32E2E]" />
        <span className="whitespace-nowrap">{active.label}</span>
        <Icon name="expand_more" size="text-sm" className={cn('text-[var(--ck-text-muted)] transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-1 shadow-2xl"
        >
          {portalOptions.map((option) => {
            const selected = option.key === activeKey
            return (
              <button
                key={option.key}
                type="button"
                role="menuitem"
                onClick={() => selectPortal(option.key)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                  selected
                    ? 'bg-[#E32E2E]/15 text-[var(--ck-text)]'
                    : isTcPortal
                      ? 'text-[var(--ck-text-muted)] hover:bg-[#fff7f7] hover:text-[var(--ck-text)]'
                      : 'text-[var(--ck-text-muted)] hover:bg-white/5 hover:text-[var(--ck-text)]'
                )}
              >
                <Icon name={option.icon} size="text-lg" className={selected ? 'text-[#E32E2E]' : 'text-[var(--ck-text-dim)]'} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span className="block truncate text-[10px] font-semibold text-[var(--ck-text-dim)]">{option.helper}</span>
                </span>
                {selected && <Icon name="check" size="text-base" className="text-[#E32E2E]" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
