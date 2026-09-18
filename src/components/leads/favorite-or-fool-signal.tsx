'use client'

import { assessFavoriteOrFool, type LeadEngagementActivity, type LeadEngagementVerdict } from '@/lib/lead-engagement'
import { cn } from '@/lib/utils'

type FavoriteOrFoolSignalProps = {
  leadId: string
  source?: string | null
  isFavorite?: boolean | null
  notes?: string | null
  sellerSituation?: string | null
  motivationScore?: number | null
  appointment?: { scheduledAt: string } | null
  activities?: LeadEngagementActivity[]
  className?: string
}

const VERDICT_STYLES: Record<LeadEngagementVerdict, {
  mark: string
  shell: string
  badge: string
  accent: string
}> = {
  favorite: {
    mark: 'F',
    shell: 'border-[var(--crm-success)]/35 bg-[var(--crm-success-soft)]',
    badge: 'bg-[var(--crm-success)] text-white',
    accent: 'text-[var(--crm-success)]',
  },
  likely_favorite: {
    mark: 'F?',
    shell: 'border-[var(--crm-success)]/25 bg-[var(--crm-success-soft)]',
    badge: 'bg-[var(--crm-success)] text-white',
    accent: 'text-[var(--crm-success)]',
  },
  unclear: {
    mark: '?',
    shell: 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)]',
    badge: 'bg-[var(--crm-brand)] text-white',
    accent: 'text-[var(--crm-brand)]',
  },
  likely_fool: {
    mark: '?F',
    shell: 'border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)]',
    badge: 'bg-[var(--crm-danger)] text-white',
    accent: 'text-[var(--crm-danger)]',
  },
  fool: {
    mark: '!',
    shell: 'border-[var(--crm-danger)]/35 bg-[var(--crm-danger-soft)]',
    badge: 'bg-[var(--crm-danger)] text-white',
    accent: 'text-[var(--crm-danger)]',
  },
}

export function FavoriteOrFoolSignal(props: FavoriteOrFoolSignalProps) {
  const result = assessFavoriteOrFool(props)
  const style = VERDICT_STYLES[result.verdict]
  const visibleSignals = [
    ...result.favoriteSignals.map((text) => ({ type: 'favorite' as const, text })),
    ...result.foolSignals.map((text) => ({ type: 'fool' as const, text })),
  ].slice(0, 2)
  const hiddenCount = result.favoriteSignals.length + result.foolSignals.length - visibleSignals.length
  const titleId = `favorite-or-fool-${props.leadId}`

  return (
    <section className={cn('rounded-xl border p-3.5', style.shell, props.className)} aria-labelledby={titleId}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className={cn('flex h-8 min-w-8 items-center justify-center rounded-lg px-1 text-[10px] font-black', style.badge)}>{style.mark}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">Favorite or Fool</p>
          <h3 id={titleId} className={cn('mt-0.5 text-sm font-black', style.accent)}>{result.label}</h3>
        </div>
        <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.06em] text-[var(--crm-text-muted)]">
          {result.favoriteSignals.length} favorite · {result.foolSignals.length} fool
        </span>
      </div>

      {visibleSignals.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5">
          {visibleSignals.map((signal) => (
            <li key={`${signal.type}:${signal.text}`} className="flex items-start gap-2 text-[11px] leading-4 text-[var(--crm-text)]" title={signal.text}>
              <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', signal.type === 'favorite' ? 'bg-[var(--crm-success)]' : 'bg-[var(--crm-danger)]')} />
              <span className="line-clamp-2">{signal.text}</span>
            </li>
          ))}
          {hiddenCount > 0 ? <li className="pl-3.5 text-[10px] font-bold text-[var(--crm-text-muted)]">+{hiddenCount} more signal{hiddenCount === 1 ? '' : 's'} in the record</li> : null}
        </ul>
      ) : null}

      <p className="mt-2.5 border-t border-[var(--crm-border)] pt-2.5 text-[11px] font-bold leading-4 text-[var(--crm-ink)] line-clamp-2" title={result.recommendation}>
        Next: {result.recommendation}
      </p>
    </section>
  )
}
