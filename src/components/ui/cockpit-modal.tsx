'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/icon'

interface CockpitModalProps {
  open: boolean
  onClose: () => void
  title?: string
  icon?: string
  /** Constrain the inner dialog width. Tailwind max-w-* class. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: React.ReactNode
  /** Optional footer row */
  footer?: React.ReactNode
}

const SIZE_MAP: Record<Required<CockpitModalProps>['size'], string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

/**
 * Standardized cockpit modal: dark + blurred backdrop, portaled to body,
 * ESC closes, backdrop-click closes.
 */
export function CockpitModal({
  open,
  onClose,
  title,
  icon,
  size = 'md',
  children,
  footer,
}: CockpitModalProps) {
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null
  if (typeof document === 'undefined') return null

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* darkened + blurred backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* dialog */}
      <div
        className={`relative w-full ${SIZE_MAP[size]} rounded-2xl shadow-2xl border overflow-hidden ck-dark`}
        style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ borderBottom: '1px solid var(--ck-border)' }}
          >
            <div className="flex items-center gap-2">
              {icon && (
                <Icon name={icon} className="!text-[color:var(--ck-accent)]" />
              )}
              <h2 className="text-lg font-bold" style={{ color: 'var(--ck-text)' }}>
                {title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="transition-colors"
              style={{ color: 'var(--ck-text-muted)' }}
              aria-label="Close"
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="px-5 py-4 max-h-[80vh] overflow-y-auto">{children}</div>
        {footer && (
          <div
            className="px-6 py-3 flex items-center justify-end gap-2"
            style={{ borderTop: '1px solid var(--ck-border)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
