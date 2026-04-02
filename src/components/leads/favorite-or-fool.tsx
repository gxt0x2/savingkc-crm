'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'

interface FavoriteOrFoolProps {
  leadId: string
  manifestId?: string
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

function getScoreLabel(score: number): string {
  if (score >= 8) return 'FAVORITE'
  if (score >= 6) return 'PROMISING'
  if (score >= 4) return 'NEUTRAL'
  if (score >= 2) return 'RISKY'
  return 'FOOL'
}

export function FavoriteOrFool({ leadId, manifestId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation }: FavoriteOrFoolProps) {
  const [analysis, setAnalysis] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const score = calculateDealScore({ leadId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation })
  const color = getScoreColor(score)
  const pct = (score / 10) * 100

  useEffect(() => {
    generateAnalysis()
  }, [leadId, score])

  async function generateAnalysis() {
    setLoading(true)
    try {
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
          notes,
          sellerSituation,
        }),
      })
      const data = await res.json()
      if (data.analysis) {
        setAnalysis(data.analysis)
      } else {
        setAnalysis(getFallbackAnalysis())
      }
    } catch {
      setAnalysis(getFallbackAnalysis())
    }
    setLoading(false)
  }

  function getFallbackAnalysis(): string {
    const hasData = notes || sellerSituation
    if (!hasData) return 'No personality data yet. Build rapport on first call using mirroring — repeat their last 3 words as a question.'
    if (station === 'negotiations') return 'Use labeling: "It seems like timing is important to you..." to uncover the Black Swan.'
    if (station === 'qualifying' || station === 'appt_set') return 'Deploy calibrated questions: "How am I supposed to do that?" to shift power dynamics.'
    return 'Use late-night FM DJ voice to build trust, then tactical empathy to surface pain points.'
  }

  const equityPct = arv && offerAmount && arv > 0
    ? Math.round(((arv - offerAmount) / arv) * 100)
    : null

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
          Favorite or Fool?
        </h2>
        <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ backgroundColor: color + '20', color }}>
          {getScoreLabel(score)}
        </span>
      </div>

      {/* Score */}
      <div className="flex items-end gap-2 mb-4">
        <span className="text-5xl font-black leading-none" style={{ color }}>
          {score.toFixed(1)}
        </span>
        <span className="text-sm text-slate-400 mb-1">/ 10</span>
      </div>

      {/* Gauge Bar */}
      <div className="relative h-3 rounded-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500 mb-4 overflow-visible">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white shadow-lg transition-all duration-700"
          style={{ left: `${pct}%`, backgroundColor: color, transform: `translate(-50%, -50%)` }}
        />
      </div>

      {/* Analysis */}
      {loading ? (
        <div className="flex items-center gap-2 mb-4">
          <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Ari analyzing...</span>
        </div>
      ) : (
        <p className="text-sm text-slate-300 leading-relaxed mb-4">
          {analysis}
        </p>
      )}

      {/* Score Breakdown */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/10">
        <div className="text-center">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Motivation</p>
          <p className="text-lg font-black text-white">{motivationScore ?? '—'}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Equity</p>
          <p className="text-lg font-black text-white">{equityPct !== null ? `${equityPct}%` : '—'}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Stage</p>
          <p className="text-lg font-black text-white capitalize">{(station || 'intake').replace(/_/g, ' ')}</p>
        </div>
      </div>
    </section>
  )
}
