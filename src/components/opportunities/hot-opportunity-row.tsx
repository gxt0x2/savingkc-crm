'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import type { HotOpportunityData } from '@/types/hot-opportunity'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toProperCase } from '@/lib/format'

function dollars(amount?: number | null): string {
  if (amount == null) return '--'
  const abs = Math.abs(amount)
  return '$' + Math.round(abs / 1000) + 'K'
}

// Compact horizontal row — drag handle, rank, avatar, name+context, Ari snippet,
// deal spread, score pill, action buttons. One glance per lead, no fluff.
export function HotOpportunityRow({
  opp,
  rank,
  onCall,
  onSms,
  onEmail,
}: {
  opp: HotOpportunityData
  rank: number
  onCall?: (phone: string, leadId: string) => void
  onSms?: (leadId: string, phone?: string) => void
  onEmail?: (email?: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: opp.leadId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Alternate background by rank for at-a-glance separation
  const surfaceClass = rank % 2 === 0 ? 'bg-[var(--ck-surface-elev)]' : 'bg-[var(--ck-surface)]'

  const scoreColor = opp.score.composite >= 75
    ? 'bg-[#E32E2E] text-white'
    : opp.score.composite >= 50
    ? 'bg-[var(--ck-surface-hi)] text-[var(--ck-text)]'
    : 'bg-[var(--ck-border-strong)] text-[var(--ck-text-muted)]'

  const initial = (opp.sellerName?.[0] || '?').toUpperCase()
  const spreadHealthy = opp.dealMath.spreadHealthy

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${surfaceClass} border border-[var(--ck-border)] rounded-lg flex items-stretch gap-3 hover:border-[var(--ck-border-strong)] hover:shadow-lg transition-all group`}
    >
      {/* Drag handle + rank */}
      <div
        className="flex items-center gap-2 px-3 flex-shrink-0 cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <Icon name="drag_indicator" size="text-lg" className="text-[var(--ck-text-dim)] group-hover:text-[var(--ck-text-muted)] transition-colors" />
        <span className="text-xl font-black text-[var(--ck-text)] tabular-nums w-7 text-center">
          {rank}
        </span>
      </div>

      {/* Avatar + core identity (clickable to lead detail) */}
      <Link
        href={`/leads/${opp.leadId}`}
        className="flex items-center gap-3 py-3 flex-1 min-w-0 hover:brightness-110 transition-all"
      >
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--ck-surface-hi)] to-[var(--ck-border-strong)] text-[var(--ck-text)] flex items-center justify-center text-sm font-black flex-shrink-0">
          {initial}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + flags */}
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-[var(--ck-text)] truncate">
              {toProperCase(opp.sellerName || 'Unknown Seller')}
            </span>
            {opp.flags.hasDeadline && (
              <span title="Has deadline" className="flex-shrink-0"><Icon name="schedule" size="text-xs" className="text-[#E32E2E]" /></span>
            )}
            {opp.flags.hasCompetingOffer && (
              <span title="Competing offer" className="flex-shrink-0"><Icon name="workspaces" size="text-xs" className="text-amber-400" /></span>
            )}
            {opp.missingFields.length > 0 && (
              <span title="Missing data" className="flex-shrink-0"><Icon name="error_outline" size="text-xs" className="text-[var(--ck-text-dim)]" /></span>
            )}
          </div>
          {/* Ari snippet OR address fallback — one line, truncated */}
          <p className="text-[11px] text-[var(--ck-text-muted)] truncate leading-snug">
            {opp.hotSignal || opp.address || 'No address on file'}
          </p>
        </div>
      </Link>

      {/* Deal spread — compact pill */}
      <div className="hidden md:flex items-center px-3 flex-shrink-0">
        <div className="text-right">
          <div className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">Spread</div>
          <div className={`text-sm font-black tabular-nums ${spreadHealthy ? 'text-emerald-400' : 'text-[#E32E2E]'}`}>
            {dollars(opp.dealMath.spread)}
          </div>
        </div>
      </div>

      {/* Score pill */}
      <div className="flex items-center px-1 flex-shrink-0">
        <div className={`${scoreColor} px-2.5 py-1.5 rounded-md text-sm font-black tabular-nums`}>
          {opp.score.composite}
        </div>
      </div>

      {/* Actions — Call primary, SMS secondary, Email tertiary */}
      <div className="flex items-center gap-1.5 pr-3 flex-shrink-0">
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (opp.phone) onCall?.(opp.phone, opp.leadId)
          }}
          disabled={!opp.phone}
          className="w-10 h-10 rounded-lg bg-[#E32E2E] hover:bg-[#C42626] text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:bg-[var(--ck-border-strong)] shadow-sm"
          title="Call"
          aria-label="Call"
        >
          <Icon name="call" size="text-base" />
        </button>
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (opp.phone) onSms?.(opp.leadId, opp.phone)
          }}
          disabled={!opp.phone}
          className="w-10 h-10 rounded-lg bg-[var(--ck-surface-hi)] hover:bg-[var(--ck-border-strong)] text-[var(--ck-text)] flex items-center justify-center transition-colors disabled:opacity-40 border border-[var(--ck-border)]"
          title="SMS"
          aria-label="SMS"
        >
          <Icon name="chat" size="text-base" />
        </button>
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (opp.email) onEmail?.(opp.email)
          }}
          disabled={!opp.email}
          className="hidden sm:flex w-10 h-10 rounded-lg bg-transparent hover:bg-white/5 text-[var(--ck-text-muted)] items-center justify-center transition-colors disabled:opacity-30 border border-[var(--ck-border)]"
          title="Email"
          aria-label="Email"
        >
          <Icon name="mail" size="text-base" />
        </button>
      </div>
    </div>
  )
}
