'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import type { HotOpportunityData } from '@/types/hot-opportunity'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function dollars(amount?: number | null): string {
  if (amount == null) return '--'
  return '$' + Math.round(amount / 1000) + 'K'
}

export function HotOpportunityCardCompact({
  opp,
  onCall,
  onSms,
  onEmail,
}: {
  opp: HotOpportunityData
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

  const scoreColor = opp.score.composite >= 75
    ? 'bg-[#E32E2E] text-white'
    : opp.score.composite >= 50
    ? 'bg-gray-800 text-white'
    : 'bg-gray-400 text-white'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-lg hover:border-gray-300 transition-all group"
    >
      {/* Drag handle indicator */}
      <div
        className="flex items-center justify-center py-2 bg-black bg-opacity-0 group-hover:bg-opacity-5 transition-colors cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <div className="flex gap-0.5">
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full group-hover:bg-gray-600 transition-colors"></div>
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full group-hover:bg-gray-600 transition-colors"></div>
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full group-hover:bg-gray-600 transition-colors"></div>
        </div>
      </div>

      <div className="p-4">
        {/* Header - Clickable to lead page */}
        <Link href={`/leads/${opp.leadId}`}>
        <div className="mb-3 cursor-pointer hover:opacity-80 transition-opacity">
          {/* County */}
          {opp.county && (
            <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              {opp.county} CO.
            </div>
          )}

          {/* Name and Score */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-lg font-black text-black leading-tight">{opp.sellerName || 'Unknown Seller'}</h3>
            <div className={`px-2 py-1 rounded text-xs font-black ${scoreColor} shrink-0`}>
              {opp.score.composite}
            </div>
          </div>

          {/* Address */}
          <p className="text-xs text-gray-600 leading-snug">
            {opp.address || 'No address'}{opp.city ? `, ${opp.city}` : ''}
          </p>
        </div>

        {/* Ari Insight */}
        {opp.hotSignal && (
          <div className="bg-gray-50 rounded-lg p-2.5 mb-3 border-l-2 border-[#E32E2E]">
            <div className="flex items-center gap-1.5 mb-1">
              <Icon name="auto_awesome" size="text-xs" className="text-[#E32E2E]" />
              <span className="text-[9px] font-black text-gray-600 uppercase tracking-wider">Ari</span>
            </div>
            <p className="text-xs text-gray-800 leading-snug line-clamp-3">
              {opp.hotSignal}
            </p>
          </div>
        )}

        {/* Deal Math Grid */}
        <div className="mb-3">
          <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
            Deal at a Glance
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[
              { label: 'ARV', value: opp.dealMath.arv },
              { label: 'Ask', value: opp.dealMath.askingPrice },
              { label: 'Offer', value: opp.dealMath.offerAmount },
              { label: 'Spread', value: opp.dealMath.spread, highlight: true },
            ].map((col) => (
              <div key={col.label} className="text-center bg-gray-50 rounded py-1.5">
                <div className="text-[9px] font-bold text-gray-500 uppercase">{col.label}</div>
                <div className={`text-xs font-black ${
                  col.highlight
                    ? opp.dealMath.spreadHealthy ? 'text-green-600' : 'text-[#E32E2E]'
                    : 'text-black'
                }`}>
                  {dollars(col.value)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="mb-3">
          <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
            Tags
          </div>
          <div className="flex flex-wrap gap-1">
            {opp.flags.hasDeadline && (
              <span className="px-2 py-1 bg-[#E32E2E] text-white text-[9px] font-bold rounded-md">
                Deadline {opp.flags.deadlineDate && new Date(opp.flags.deadlineDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
            {opp.flags.hasCompetingOffer && (
              <span className="px-2 py-1 bg-black text-white text-[9px] font-bold rounded-md">
                Competing offer
              </span>
            )}
            {opp.flags.hasLifeEvent && (
              <span className="px-2 py-1 bg-gray-700 text-white text-[9px] font-bold rounded-md">
                {opp.flags.lifeEventType || 'Life event'}
              </span>
            )}
            {opp.missingFields.length > 0 && (
              <span className="px-2 py-1 bg-gray-400 text-white text-[9px] font-bold rounded-md">
                Missing data
              </span>
            )}
          </div>
        </div>

        {/* Next Action */}
        {opp.hotNextMove && (
          <div className="mb-3 bg-gray-50 rounded-lg p-2.5 border-l-2 border-[#E32E2E]">
            <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">
              Next Action
            </div>
            <p className="text-xs text-black font-semibold">{opp.hotNextMove}</p>
          </div>
        )}
        </Link>

        {/* Quick Actions — hierarchy: Call (primary) > SMS > Email */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (opp.phone) {
                onCall?.(opp.phone, opp.leadId)
              }
            }}
            disabled={!opp.phone}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#E32E2E] text-white font-bold text-xs hover:bg-[#C42626] transition-colors disabled:opacity-40 disabled:bg-gray-300 shadow-sm"
          >
            <Icon name="call" size="text-sm" />
            Call
          </button>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (opp.phone) {
                onSms?.(opp.leadId, opp.phone)
              }
            }}
            disabled={!opp.phone}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-black text-white font-bold text-xs hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:bg-gray-300"
          >
            <Icon name="chat" size="text-sm" />
            SMS
          </button>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (opp.email) {
                onEmail?.(opp.email)
              }
            }}
            disabled={!opp.email}
            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 font-bold text-xs hover:border-gray-400 hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            <Icon name="mail" size="text-sm" />
          </button>
        </div>
      </div>
    </div>
  )
}
