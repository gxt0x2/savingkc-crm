'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface CollapsibleCardProps {
  id: string
  title: string
  icon?: string
  defaultOpen?: boolean
  /** Visual emphasis on the card border (subtle pulse, still non-intrusive). */
  attention?: boolean
  children: React.ReactNode
  /** Optional action rendered in the header (e.g., a refresh button). */
  action?: React.ReactNode
  /** Extra class names on the outer <section>. */
  className?: string
}

/**
 * Reusable collapsible card that matches the cockpit design language.
 * Persists open/closed state to localStorage per id.
 */
export function CollapsibleCard({
  id,
  title,
  icon,
  defaultOpen = true,
  attention,
  children,
  action,
  className,
}: CollapsibleCardProps) {
  const storageKey = `ck_collapse_${id}`
  const [open, setOpen] = useState(defaultOpen)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw != null) setOpen(raw === '1')
    } catch {
      /* ignore */
    }
    setReady(true)
  }, [storageKey])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(storageKey, open ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [open, ready, storageKey])

  return (
    <section
      className={`rounded-2xl border transition-shadow ${className ?? ''} ${attention ? 'ck-attention' : ''}`}
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3"
      >
        <div className="flex items-center gap-2">
          {icon && (
            <Icon name={icon} className="!text-sm !text-[color:var(--ck-accent)]" />
          )}
          <span className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {action}
          <Icon
            name={open ? 'expand_less' : 'expand_more'}
            className="!text-base !text-[color:var(--ck-text-muted)]"
          />
        </div>
      </button>
      {open && <div className="px-5 pb-5 pt-1">{children}</div>}
    </section>
  )
}
