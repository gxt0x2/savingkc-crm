'use client'

import { cn } from '@/lib/utils'
import type { AppMode } from '@/hooks/use-app-mode'

interface ModeSwitcherProps {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  return (
    <div className="flex items-center bg-slate-100 rounded-full p-0.5 text-xs font-semibold">
      <button
        onClick={() => onChange('acquisitions')}
        className={cn(
          'px-3 py-1 rounded-full transition-all whitespace-nowrap',
          mode === 'acquisitions'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        )}
      >
        Acquisitions
      </button>
      <button
        onClick={() => onChange('dispositions')}
        className={cn(
          'px-3 py-1 rounded-full transition-all whitespace-nowrap',
          mode === 'dispositions'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        )}
      >
        Dispositions
      </button>
    </div>
  )
}
