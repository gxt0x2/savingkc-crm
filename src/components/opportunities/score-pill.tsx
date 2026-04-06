'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { HotScoreBreakdown, HotTierLabel } from '@/types/hot-opportunity'

const TIER_CONFIG: Record<HotTierLabel, { color: string; bg: string; icon: string; label: string }> = {
  favorite: { color: 'text-green-700', bg: 'bg-green-100', icon: 'local_fire_department', label: 'Favorite' },
  caution: { color: 'text-amber-700', bg: 'bg-amber-100', icon: 'warning', label: 'Caution' },
  long_shot: { color: 'text-slate-500', bg: 'bg-slate-100', icon: 'schedule', label: 'Long Shot' },
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-on-surface-variant w-20 shrink-0 uppercase tracking-wide">{label}</span>
      <div className="flex-1 h-2 bg-surface-container-high rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-bold text-on-surface-variant w-8 text-right">{value}/{max}</span>
    </div>
  )
}

export function ScorePill({ score, onClick }: { score: HotScoreBreakdown; onClick?: () => void }) {
  const [showPopover, setShowPopover] = useState(false)
  const tier = TIER_CONFIG[score.tierLabel] || TIER_CONFIG.long_shot

  return (
    <div className="relative">
      <button
        onClick={() => { setShowPopover(!showPopover); onClick?.() }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${tier.bg} ${tier.color} transition-all hover:ring-2 hover:ring-offset-1 hover:ring-current/20`}
      >
        <Icon name={tier.icon} size="text-xs" />
        <span>{score.composite}</span>
        {score.tierCapped && <Icon name="lock" size="text-[10px]" className="opacity-60" />}
      </button>

      {showPopover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowPopover(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-xl shadow-xl border border-outline-variant/20 p-4 w-64">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-sm font-bold ${tier.color}`}>{tier.label}</span>
              <span className="text-2xl font-black text-primary">{score.composite}</span>
            </div>
            {score.tierCapped && (
              <p className="text-[10px] text-amber-600 mb-3 bg-amber-50 px-2 py-1 rounded">
                Score capped — missing data for Favorite tier
              </p>
            )}
            <div className="space-y-2.5">
              <ScoreBar label="Engage" value={score.engagement} max={35} color="bg-blue-500" />
              <ScoreBar label="Velocity" value={score.velocity} max={25} color="bg-purple-500" />
              <ScoreBar label="Deal" value={score.dealQuality} max={25} color="bg-green-500" />
              <ScoreBar label="Urgency" value={score.timePressure} max={15} color="bg-orange-500" />
            </div>
            {score.multiplier > 1 && (
              <p className="text-[10px] text-on-surface-variant mt-3">
                {score.multiplier}x multiplier applied
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
