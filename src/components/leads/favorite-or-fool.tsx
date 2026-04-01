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

function getGradientPercent(score: number): number {
  return (score / 10) * 100
}

export function FavoriteOrFool({ leadId, manifestId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation }: FavoriteOrFoolProps) {
  const [analysis, setAnalysis] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const score = calculateDealScore({ leadId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation })
  const color = getScoreColor(score)
  const pct = getGradientPercent(score)

  useEffect(() => {
    generateAnalysis()
  }, [leadId, score])

  async function generateAnalysis() {
    setLoading(true)

    // Generate 2-sentence Chris Voss-based tactical insight
    let sentence1 = ''
    let sentence2 = ''

    // Sentence 1: Personality type assessment (if no data, say so)
    const hasPersonalityData = notes || sellerSituation
    if (hasPersonalityData) {
      // Try to infer personality from notes
      const text = (notes || '') + ' ' + (sellerSituation || '')
      const lowerText = text.toLowerCase()
      if (lowerText.includes('data') || lowerText.includes('detail') || lowerText.includes('number')) {
        sentence1 = 'Analyst personality detected — values data, details, and systematic thinking.'
      } else if (lowerText.includes('relationship') || lowerText.includes('family') || lowerText.includes('feel')) {
        sentence1 = 'Accommodator personality — relationship-focused, seeks harmony, values empathy.'
      } else if (lowerText.includes('quick') || lowerText.includes('decision') || lowerText.includes('direct')) {
        sentence1 = 'Assertive personality — direct, action-oriented, values efficiency and results.'
      } else {
        sentence1 = 'Personality profile building — continue gathering behavioral cues during interactions.'
      }
    } else {
      sentence1 = 'No personality data yet.'
    }

    // Sentence 2: Specific Chris Voss tactic
    if (!hasPersonalityData) {
      sentence2 = 'Build rapport on first call using mirroring — repeat their last 3 words as a question.'
    } else if (station === 'negotiations') {
      sentence2 = 'Use labeling: "It seems like timing is important to you..." to uncover the Black Swan.'
    } else if (station === 'qualifying' || station === 'appt_set') {
      sentence2 = 'Deploy calibrated questions: "How am I supposed to do that?" to shift power dynamics.'
    } else {
      sentence2 = 'Use late-night FM DJ voice to build trust, then tactical empathy to surface pain points.'
    }

    setAnalysis(`${sentence1} ${sentence2}`)
    setLoading(false)
  }

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl font-black leading-none" style={{ color }}>
          {score.toFixed(1)}
        </span>
        <div className="flex-1">
          <h2 className="text-xs font-black uppercase tracking-wider text-white">
            Favorite or Fool?
          </h2>
        </div>
      </div>

      {/* Analysis Text - exactly 2 sentences */}
      {loading ? (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Analyzing...</span>
        </div>
      ) : (
        <p className="text-xs text-slate-300 leading-relaxed">
          {analysis}
        </p>
      )}
    </section>
  )
}
