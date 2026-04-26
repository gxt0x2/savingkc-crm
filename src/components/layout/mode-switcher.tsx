'use client'

import { cn } from '@/lib/utils'
import type { AppMode } from '@/hooks/use-app-mode'

interface ModeSwitcherProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  return (
    <div
      className="flex items-center rounded-full p-0.5 text-xs font-semibold"
      style={{ background: 'var(--ck-surface-elev)' }}
    >
      <button
        onClick={() => onChange('acquisitions')}
        className={cn(
          'px-3 py-1 rounded-full transition-all whitespace-nowrap',
          mode === 'acquisitions'
            ? 'shadow-sm text-[var(--ck-text)]'
            : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
        )}
        style={mode === 'acquisitions'
          ? { background: 'var(--ck-surface)' }
          : undefined}
      >
        Acquisitions
      </button>
      <button
        onClick={() => onChange('dispositions')}
        className={cn(
          'px-3 py-1 rounded-full transition-all whitespace-nowrap',
          mode === 'dispositions'
            ? 'shadow-sm text-[var(--ck-text)]'
            : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
        )}
        style={mode === 'dispositions'
          ? { background: 'var(--ck-surface)' }
          : undefined}
      >
        Dispositions
      </button>
    </div>
  )
}
