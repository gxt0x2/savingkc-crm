'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'

interface FavoriteOrFoolProps {
  leadId: string
  motivationScore: number | null
  arv: number | null
  offerAmount: number | null
  repairEstimate: number | null
  station: string | null
  notes: string | null
  sellerSituation: string | null
}

function calculateDealScore(props: FavoriteOrFoolProps): number {
  let score = 5.0 // Base score

  // Motivation component (0-3 points)
  if (props.motivationScore) {
    score += (props.motivationScore / 10) * 3
  }

  // Equity component (0-2.5 points)
  if (props.arv && props.offerAmount && props.arv > 0) {
    const equityRatio = (props.arv - props.offerAmount) / props.arv
    if (equityRatio > 0.4) score += 2.5
    else if (equityRatio > 0.3) score += 2.0
    else if (equityRatio > 0.2) score += 1.0
    else if (equityRatio > 0.1) score += 0.5
    else score -= 1
  }

  // Stage advancement bonus (0-1.5 points)
  const stageScores: Record<string, number> = {
    contract_signed: 1.5,
    negotiations: 1.2,
    appt_set: 1.0,
    qualifying: 0.7,
    contacted: 0.3,
    not_contacted: 0,
    intake: 0,
    dead: -2,
  }
  score += stageScores[props.station || 'intake'] ?? 0

  // Clamp to 0-10
  return Math.round(Math.min(10, Math.max(0, score)) * 10) / 10
}

function getScoreColor(score: number): string {
  if (score >= 8) return '#22c55e'  // green
  if (score >= 6) return '#84cc16'  // lime
  if (score >= 4) return '#eab308'  // yellow
  if (score >= 2) return '#f97316'  // orange
  return '#ef4444'                   // red
}

function getGradientPercent(score: number): number {
  return (score / 10) * 100
}

export function FavoriteOrFool({ leadId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation }: FavoriteOrFoolProps) {
  const [analysis, setAnalysis] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const score = calculateDealScore({ leadId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation })
  const color = getScoreColor(score)
  const pct = getGradientPercent(score)

  useEffect(() => {
    generateAnalysis()
  }, [leadId, score])

  async function generateAnalysis() {
    // Try API
    try {
      setLoading(true)
      const res = await fetch('/api/ari/deal-score-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score,
          motivationScore,
          arv,
          offerAmount,
          repairEstimate,
          station,
          notes: notes?.slice(0, 500),
          sellerSituation,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.analysis) {
          setAnalysis(data.analysis)
          setLoading(false)
          return
        }
      }
    } catch {
      // fallback
    }

    // Local fallback
    if (score >= 8) {
      setAnalysis('Strong deal indicators. High motivation combined with favorable equity position. This lead shows characteristics of a closeable deal.')
    } else if (score >= 6) {
      setAnalysis('Promising lead with room to work. Continue building rapport and verify financial details to strengthen the deal position.')
    } else if (score >= 4) {
      setAnalysis('Mixed signals on this one. Some positive indicators but gaps remain. Needs more discovery to determine viability.')
    } else {
      setAnalysis('Challenging deal profile. Consider whether continued pursuit is the best use of resources or if nurturing is more appropriate.')
    }
    setLoading(false)
  }

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="star_rate" className="!text-lg text-amber-400" />
        <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
          Favorite or Fool?
        </h2>
      </div>

      {/* Score Display */}
      <div className="flex items-end gap-3 mb-4">
        <span className="text-5xl font-black leading-none" style={{ color }}>
          {score.toFixed(1)}
        </span>
        <span className="text-sm text-slate-400 font-medium pb-1">/ 10</span>
      </div>

      {/* Gauge Bar */}
      <div className="relative h-3 rounded-full overflow-hidden mb-4"
        style={{ background: 'linear-gradient(90deg, #ef4444, #f97316, #eab308, #84cc16, #22c55e)' }}
      >
        {/* Indicator */}
        <div
          className="absolute top-[-2px] w-4 h-4 rounded-full bg-white border-2 shadow-lg transition-all duration-500"
          style={{
            left: `calc(${pct}% - 8px)`,
            borderColor: color,
            boxShadow: `0 0 8px ${color}60`,
          }}
        />
        {/* Darken the portion after the score */}
        <div
          className="absolute top-0 right-0 bottom-0 bg-[#1B2A4A]/60"
          style={{ left: `${pct}%` }}
        />
      </div>

      {/* Analysis Text */}
      {loading ? (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Analyzing deal...</span>
        </div>
      ) : (
        <p className="text-sm text-slate-300 leading-relaxed">
          {analysis}
        </p>
      )}

      {/* Score Breakdown */}
      <div className="mt-4 pt-3 border-t border-white/10 grid grid-cols-3 gap-2">
        <div className="text-center">
          <p className="text-[10px] text-slate-500 uppercase font-bold">Motivation</p>
          <p className="text-sm font-bold text-white">{motivationScore ?? '--'}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-500 uppercase font-bold">Equity</p>
          <p className="text-sm font-bold text-white">
            {arv && offerAmount ? `${Math.round(((arv - offerAmount) / arv) * 100)}%` : '--'}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-500 uppercase font-bold">Stage</p>
          <p className="text-sm font-bold text-white capitalize">{(station || 'intake').replace(/_/g, ' ')}</p>
        </div>
      </div>
    </section>
  )
}
