import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import { KanbanCard, type KanbanCardData } from './kanban-card'
import type { DealStage } from '@/types'

interface BadgeStyle {
  bg: string
  text: string
}

const badgeStyles: Record<DealStage, BadgeStyle> = {
  new: { bg: 'bg-primary', text: 'text-white' },
  not_contacted: { bg: 'bg-outline-variant', text: 'text-on-surface-variant' },
  contacted: { bg: 'bg-outline-variant', text: 'text-on-surface-variant' },
  qualifying: { bg: 'bg-secondary', text: 'text-white' },
  appt_set: { bg: 'bg-outline-variant', text: 'text-on-surface-variant' },
  negotiations: { bg: 'bg-tertiary-container', text: 'text-on-tertiary-container' },
  contract_signed: { bg: 'bg-secondary', text: 'text-white' },
}

export function KanbanColumn({
  title,
  stage,
  cards,
}: {
  title: string
  stage: DealStage
  cards: KanbanCardData[]
}) {
  const badge = badgeStyles[stage]
  const isContractSigned = stage === 'contract_signed'

  return (
    <section className="min-w-[320px] max-w-[320px] flex flex-col bg-surface-container-low rounded-xl shrink-0 h-full">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-outline-variant/10">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-sm tracking-wide uppercase text-on-surface-variant">
            {title}
          </h3>
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full font-bold',
              badge.bg,
              badge.text
            )}
          >
            {cards.length}
          </span>
        </div>
        <button className="text-on-surface-variant hover:text-on-surface transition-colors">
          <Icon name="more_vert" size="text-[18px]" />
        </button>
      </div>

      {/* Scrollable cards */}
      <div
        className={cn(
          'flex-1 overflow-y-auto p-3 space-y-4',
          isContractSigned && 'opacity-70 grayscale-[0.3]'
        )}
      >
        {cards.map((card) => (
          <KanbanCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  )
}
