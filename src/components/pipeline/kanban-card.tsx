import { Icon } from '@/components/ui/icon'
import { PersonalityBadge } from '@/components/ui/personality-badge'
import { cn, formatCurrency } from '@/lib/utils'
import type { PersonalityType, DealStage } from '@/types'

export interface KanbanCardData {
  id: string
  initials: string
  name: string
  address: string
  personalityType: PersonalityType | null
  timerLabel?: string
  timerUrgent?: boolean
  nextStep?: string
  lastActivity?: string
  estFee?: number
  stage: DealStage
  callAttempts?: number
  statusNote?: string
  progressPercent?: number
  statusLabel?: string
  contractLocked?: boolean
  avatarBg?: string
}

const showFeeStages: DealStage[] = ['qualifying', 'appt_set', 'negotiations', 'contract_signed']

export function KanbanCard({ card, onClick }: { card: KanbanCardData; onClick?: (id: string) => void }) {
  const showFee = showFeeStages.includes(card.stage) && card.estFee != null
  const isContacted = card.stage === 'contacted'

  return (
    <div
      onClick={() => onClick?.(card.id)}
      className={cn(
        'bg-surface-container-lowest p-4 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-md transition-shadow cursor-pointer border border-transparent hover:border-outline-variant/20',
        isContacted && 'border-l-4 border-l-secondary',
        card.stage === 'qualifying' && 'border-l-4 border-l-primary',
        card.stage === 'contract_signed' && 'border border-secondary/20'
      )}
    >
      {/* Top row: avatar + timer or fee */}
      <div className="flex justify-between items-start mb-2">
        <div
          className={cn(
            'size-8 rounded-full flex items-center justify-center font-bold text-xs',
            card.avatarBg || 'bg-primary-fixed text-on-primary-fixed'
          )}
        >
          {card.initials}
        </div>
        {card.timerLabel && (
          <div
            className={cn(
              'flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded',
              card.timerUrgent
                ? 'text-error bg-error-container/30'
                : 'text-on-secondary-container bg-secondary-container/20'
            )}
          >
            <Icon name="timer" size="text-[14px]" /> {card.timerLabel}
          </div>
        )}
        {showFee && !card.timerLabel && (
          <div className="text-secondary font-bold text-sm">
            {formatCurrency(card.estFee!)} Fee
          </div>
        )}
      </div>

      {/* Name */}
      <h4 className="font-bold text-primary mb-1">{card.name}</h4>

      {/* Status note (qualifying) */}
      {card.statusNote && (
        <p className="text-on-surface-variant text-sm mb-3 italic">&ldquo;{card.statusNote}&rdquo;</p>
      )}

      {/* Address */}
      <p className="text-on-surface-variant text-sm mb-3">{card.address}</p>

      {/* Fee if also has timer */}
      {showFee && card.timerLabel && (
        <div className="text-secondary font-bold text-sm mb-3">
          {formatCurrency(card.estFee!)} Fee
        </div>
      )}

      {/* Appointment block */}
      {card.stage === 'appt_set' && card.nextStep && (
        <div className="bg-surface-container-low p-2 rounded mb-3 border-l-2 border-primary">
          <p className="text-[10px] text-on-surface-variant font-bold uppercase">
            {card.nextStep.split(' - ')[0] || 'Upcoming'}
          </p>
          <p className="text-[12px] font-bold">
            {card.nextStep.split(' - ')[1] || card.nextStep}
          </p>
        </div>
      )}

      {/* Progress bar (negotiations) */}
      {card.progressPercent != null && (
        <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden mb-3">
          <div className="bg-secondary h-full" style={{ width: `${card.progressPercent}%` }} />
        </div>
      )}

      {/* Next step / last activity (non-appt stages) */}
      {card.stage !== 'appt_set' && card.stage !== 'contract_signed' && (card.nextStep || card.lastActivity) && (
        <div className="flex flex-col gap-1 mb-3 text-[12px]">
          {card.nextStep && (
            <div className="flex items-center gap-2">
              <span className="text-on-surface-variant">Next:</span>
              <span className="font-semibold text-primary">{card.nextStep}</span>
            </div>
          )}
          {card.callAttempts && (
            <div className="text-on-surface-variant/70 text-[11px]">
              {card.callAttempts} Call attempts made
            </div>
          )}
          {card.lastActivity && (
            <div className="text-on-surface-variant/70 text-[11px]">
              Last Activity: {card.lastActivity}
            </div>
          )}
        </div>
      )}

      {/* Contract locked */}
      {card.contractLocked && (
        <div className="flex items-center gap-2 text-on-secondary-container font-bold text-[11px] mb-3">
          <Icon name="verified" size="text-[16px]" /> Contract Locked
        </div>
      )}

      {/* Bottom: personality + status */}
      <div className="flex items-center justify-between">
        <PersonalityBadge type={card.personalityType} />
        {card.statusLabel && (
          <span className="text-[11px] font-bold text-tertiary">{card.statusLabel}</span>
        )}
        {card.lastActivity && card.stage !== 'contract_signed' && card.stage !== 'not_contacted' && !card.statusLabel && card.nextStep && (
          <span className="text-[11px] text-on-surface-variant/60">Updated {card.lastActivity}</span>
        )}
      </div>
    </div>
  )
}
