'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { ScorePill } from './score-pill'
import type { HotOpportunityData } from '@/types/hot-opportunity'

function dollars(amount?: number | null): string {
  if (amount == null) return '--'
  return '$' + amount.toLocaleString('en-US')
}

function stageLabel(station: string): string {
  const labels: Record<string, string> = {
    intake: 'Intake', new: 'New', contacted: 'Leads',
    qualifying: 'Qualifying', qualified: 'Opportunities',
    appt_set: 'Appt Set', appointment_set: 'Appointment Set', discovery: 'Discovery',
    research: 'Research', valuation: 'Valuation',
    offer: 'Offer', offer_made: 'Offer Made',
    negotiations: 'Negotiations', contract: 'Contract',
    under_contract: 'Under Contract', inspection: 'Inspection',
    closing_prep: 'Closing Prep', closing: 'Closing',
    closed_won: 'Closed Won', closed_lost: 'Closed Lost',
  }
  return labels[station] || station
}

function MotivationDots({ history }: { history: HotOpportunityData['motivationHistory'] }) {
  if (!history || history.length === 0) return null
  const recent = history.slice(-5)
  const colors = { cold: 'bg-blue-400', warm: 'bg-amber-400', hot: 'bg-red-400' }
  return (
    <div className="flex items-center gap-1">
      {recent.map((h, i) => (
        <div key={i} className={`w-2 h-2 rounded-full ${colors[h.level]}`} title={`${h.level} — ${h.callDate}`} />
      ))}
    </div>
  )
}

function CadenceDot({ status }: { status: 'green' | 'amber' | 'red' | 'gray' }) {
  const colors = {
    green: 'bg-green-400',
    amber: 'bg-amber-400',
    red: 'bg-red-400',
    gray: 'bg-slate-300',
  }
  return <div className={`w-2 h-2 rounded-full ${colors[status]}`} />
}

export function HotOpportunityCard({
  opp,
  onCall,
}: {
  opp: HotOpportunityData
  onCall?: (phone: string, leadId: string) => void
}) {
  const heatGradient = opp.score.composite >= 75
    ? 'bg-gradient-to-r from-orange-400 via-red-400 to-red-500'
    : opp.score.composite >= 50
    ? `bg-gradient-to-r from-amber-300 to-amber-400`
    : 'bg-slate-300'

  // Proportional fill for caution tier
  const heatWidth = opp.score.tierLabel === 'caution'
    ? `${Math.round(((opp.score.composite - 50) / 25) * 100)}%`
    : '100%'

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-md border border-outline-variant/20 overflow-hidden hover:shadow-lg transition-shadow">
      {/* 1. Heat bar */}
      <div className="h-1 bg-surface-container-high">
        <div className={`h-full ${heatGradient}`} style={{ width: heatWidth }} />
      </div>

      <div className="p-5 flex flex-col gap-4">
        {/* 2. Header */}
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0">
            <p className="text-[16px] font-medium text-primary truncate">{opp.address || 'No Address'}</p>
            <p className="text-[13px] text-on-surface-variant truncate">{opp.sellerName}{opp.county ? ` · ${opp.county} Co.` : ''}</p>
            {opp.dealMath.arv && opp.address && (
              <p className="text-[11px] text-on-surface-variant/70 truncate">
                {opp.currentStation === 'offer_made' ? 'Offer pending' : stageLabel(opp.currentStation)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ScorePill score={opp.score} />
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-purple-700 bg-[#EEEDFE]">
              {stageLabel(opp.currentStation)}
            </span>
          </div>
        </div>

        {/* 3. Source row */}
        {(opp.leadSource || opp.leadAge) && (
          <p className="text-[11px] text-on-surface-variant/60">
            {opp.leadSource && <span>{opp.leadSource.replace(/_/g, ' ')}</span>}
            {opp.leadSource && opp.leadAge && <span> · </span>}
            {opp.leadAge && <span>{opp.leadAge} old</span>}
          </p>
        )}

        {/* 4. Signal */}
        {opp.hotSignal && (
          <div className="bg-surface-container-low rounded-lg p-3">
            <p className="text-[13px] text-on-surface leading-snug">{opp.hotSignal}</p>
            <p className="text-[11px] text-on-surface-variant/60 mt-1">— {opp.hotSignalSource || 'Ari'}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {opp.flags.hasDeadline && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                  Deadline {opp.flags.deadlineDate ? new Date(opp.flags.deadlineDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                </span>
              )}
              {opp.flags.hasLifeEvent && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                  {opp.flags.lifeEventType || 'Life Event'}
                </span>
              )}
              {opp.flags.hasCompetingOffer && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                  Competing Offer{opp.flags.competingOfferSpecificity === 'specific' ? ' (specific)' : ''}
                </span>
              )}
              <MotivationDots history={opp.motivationHistory} />
            </div>
          </div>
        )}

        {/* 5. Deal math — 5 col grid */}
        <div className="grid grid-cols-5 gap-1 text-center">
          {[
            { label: 'ARV', value: opp.dealMath.arv, sub: opp.dealMath.arvSource },
            { label: 'As-Is', value: opp.dealMath.asIsValue },
            { label: 'Asking', value: opp.dealMath.askingPrice },
            { label: 'Offer', value: opp.dealMath.offerAmount },
            { label: 'Spread', value: opp.dealMath.spread, highlight: true },
          ].map((col) => (
            <div key={col.label}>
              <div className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider">{col.label}</div>
              <div className={`text-[13px] font-bold ${
                col.highlight
                  ? opp.dealMath.spreadHealthy ? 'text-green-600' : 'text-red-500'
                  : 'text-primary'
              }`}>
                {dollars(col.value)}
              </div>
              {col.sub && <div className="text-[9px] text-on-surface-variant/50">{col.sub}</div>}
            </div>
          ))}
        </div>

        {/* 6. Data completeness warning */}
        {opp.missingFields.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <Icon name="warning" size="text-sm" className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-700">
              Missing: {opp.missingFields.join(', ')}
            </p>
          </div>
        )}

        {/* 7. Next move */}
        {opp.hotNextMove && (
          <div className="border-l-[3px] border-[#534AB7] pl-3 py-1">
            <p className="text-[13px] text-on-surface font-medium">{opp.hotNextMove}</p>
            {opp.assignedAgent && (
              <p className="text-[11px] text-on-surface-variant/60 mt-0.5">{opp.assignedAgent}</p>
            )}
          </div>
        )}

        {/* 8. Quick actions */}
        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={() => opp.phone && onCall?.(opp.phone, opp.leadId)}
            disabled={!opp.phone}
            className="flex flex-col items-center gap-1 py-2 rounded-lg bg-surface-container-low hover:bg-surface-container-high transition-colors disabled:opacity-40"
          >
            <Icon name="call" size="text-sm" className="text-green-600" />
            <span className="text-[10px] font-bold text-on-surface-variant">Call</span>
          </button>
          <Link
            href={`/conversations?lead=${opp.leadId}`}
            className="flex flex-col items-center gap-1 py-2 rounded-lg bg-surface-container-low hover:bg-surface-container-high transition-colors"
          >
            <Icon name="chat" size="text-sm" className="text-blue-600" />
            <span className="text-[10px] font-bold text-on-surface-variant">Text</span>
          </Link>
          <button className="flex flex-col items-center gap-1 py-2 rounded-lg bg-surface-container-low hover:bg-surface-container-high transition-colors">
            <Icon name="description" size="text-sm" className="text-purple-600" />
            <span className="text-[10px] font-bold text-on-surface-variant">DocuSeal</span>
          </button>
          <Link
            href={`/leads/${opp.leadId}`}
            className="flex flex-col items-center gap-1 py-2 rounded-lg bg-surface-container-low hover:bg-surface-container-high transition-colors"
          >
            <Icon name="open_in_new" size="text-sm" className="text-primary" />
            <span className="text-[10px] font-bold text-on-surface-variant">Full Lead</span>
          </Link>
        </div>

        {/* 9. Contact history */}
        <div className="flex items-center gap-4 text-[11px] text-on-surface-variant/60">
          {opp.lastCallDate && <span>Call: {opp.lastCallDate}</span>}
          {opp.lastTextDate && <span>Text: {opp.lastTextDate}</span>}
          {opp.lastEmailDate && <span>Email: {opp.lastEmailDate}</span>}
          {opp.lastMailDate && <span>Mail: {opp.lastMailDate}</span>}
          {!opp.lastCallDate && !opp.lastTextDate && !opp.lastEmailDate && !opp.lastMailDate && (
            <span>No contact history</span>
          )}
        </div>

        {/* 10. Cooling indicator */}
        {opp.coolingIndicator && opp.coolingIndicator.attemptsSinceResponse >= 2 && opp.coolingIndicator.daysSinceResponse > 3 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <Icon name="ac_unit" size="text-sm" className="text-blue-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-blue-700">
              Cooling: {opp.coolingIndicator.attemptsSinceResponse} attempts, {opp.coolingIndicator.daysSinceResponse}d since response
            </p>
          </div>
        )}

        {/* 11. Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-surface-container-high">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-on-surface-variant/50 uppercase">Call</span>
              <CadenceDot status={opp.cadenceHealth.call} />
              <span className="text-[9px] text-on-surface-variant/50 uppercase ml-1">Text</span>
              <CadenceDot status={opp.cadenceHealth.text} />
              <span className="text-[9px] text-on-surface-variant/50 uppercase ml-1">Email</span>
              <CadenceDot status={opp.cadenceHealth.email} />
              <span className="text-[9px] text-on-surface-variant/50 uppercase ml-1">Mail</span>
              <CadenceDot status={opp.cadenceHealth.mail} />
            </div>
          </div>
          <span className="text-[10px] text-on-surface-variant/50">
            Ari evaluated {opp.lastScoredAt ? formatTimeAgo(opp.lastScoredAt) : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  )
}

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
