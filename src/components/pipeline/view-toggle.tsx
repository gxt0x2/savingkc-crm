'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

export function ViewToggle({ view }: { view: 'kanban' | 'list' }) {
  return (
    <div className="flex items-center gap-1 bg-surface-container-low rounded-lg p-1">
      <Link
        href="/pipeline"
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
          view === 'kanban'
            ? 'bg-surface-container-lowest text-primary shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        )}
      >
        <Icon name="view_kanban" size="text-sm" />
        Kanban
      </Link>
      <Link
        href="/pipeline?view=list"
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
          view === 'list'
            ? 'bg-surface-container-lowest text-primary shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        )}
      >
        <Icon name="view_list" size="text-sm" />
        List
      </Link>
    </div>
  )
}
