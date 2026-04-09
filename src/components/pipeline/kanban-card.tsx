import { Icon } from '@/components/ui/icon'
import { PersonalityBadge } from '@/components/ui/personality-badge'
import { GhostRiskBadge } from '@/components/leads/ghost-risk-badge'
import { cn, formatCurrency } from '@/lib/utils'
import { calculateTemperature, TEMPERATURE_CONFIG } from '@/lib/lead-temperature'
import { formatPhone } from '@/lib/format'
import type { PersonalityType, DealStage } from '@/types'

export interface KanbanCardData {
  id: string
  initials: string
  name: string
  address: string
  phone?: string | null
  email?: string | null
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
  created_at?: string
  ghostRiskScore?: number
  ghostProtocolActive?: boolean
}

const showFeeStages: DealStage[] = ['qualifying', 'appt_set', 'negotiations', 'contract_signed']

export function KanbanCard({ card, onClick }: { card: KanbanCardData; onClick?: (id: string) => void }) {
  const showFee = showFeeStages.includes(card.stage) && card.estFee != null
  const isContacted = card.stage === 'contacted'
  const temp = calculateTemperature({
    priority: card.timerUrgent ? 'hot' : null,
    station: card.stage,
    created_at: card.created_at || new Date().toISOString(),
  })
  const tempCfg = TEMPERATURE_CONFIG[temp]

  return (
    <div
      onClick={() => onClick?.(card.id)}
      className={cn(
        'group bg-surface-container-lowest p-4 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-md transition-shadow cursor-pointer border border-transparent hover:border-outline-variant/20',
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

      {/* Name + Ghost Risk */}
      <div className="flex items-center gap-2 mb-1">
        <h4 className="font-bold text-primary">{card.name}</h4>
        {(card.ghostRiskScore != null && card.ghostRiskScore > 0 || card.ghostProtocolActive) && (
          <GhostRiskBadge ghostRiskScore={card.ghostRiskScore || 0} ghostProtocolActive={card.ghostProtocolActive} />
        )}
      </div>

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

      {/* Bottom: personality + temperature + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PersonalityBadge type={card.personalityType} />
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tempCfg.bg} ${tempCfg.text}`}>
            <span className={`w-1 h-1 rounded-full ${tempCfg.dot}`} />
            {temp.charAt(0).toUpperCase() + temp.slice(1)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {card.statusLabel && (
            <span className="text-[11px] font-bold text-tertiary">{card.statusLabel}</span>
          )}
          {card.lastActivity && card.stage !== 'contract_signed' && card.stage !== 'not_contacted' && !card.statusLabel && card.nextStep && (
            <span className="text-[11px] text-on-surface-variant/60">Updated {card.lastActivity}</span>
          )}
        </div>
      </div>

      {/* Action buttons — hover reveal */}
      <div className="mt-3 pt-3 border-t border-outline-variant/10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (card.phone) window.dispatchEvent(new CustomEvent('crm:dial', { detail: { phone: card.phone } }))
          }}
          disabled={!card.phone}
          title={card.phone ? `Call ${formatPhone(card.phone)}` : 'No phone'}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] font-bold hover:bg-green-50 text-slate-400 hover:text-green-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Icon name="call" size="text-sm" /> Call
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            window.location.href = `/conversations?lead=${card.id}`
          }}
          title="Open conversation"
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] font-bold hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
        >
          <Icon name="sms" size="text-sm" /> SMS
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (card.email) window.location.href = `mailto:${card.email}`
          }}
          disabled={!card.email}
          title={card.email ? `Email ${card.email}` : 'No email'}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] font-bold hover:bg-purple-50 text-slate-400 hover:text-purple-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Icon name="mail" size="text-sm" /> Email
        </button>
      </div>
    </div>
  )
}
