'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'

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

interface ManifestData {
  owner?: {
    fullName?: string
    motivation?: string
    timeline?: string
    reasonForSelling?: string
  }
  property?: {
    condition?: string
    occupancyStatus?: string
  }
  financials?: {
    mortgage_balance?: number
    liens_amount?: number
    back_taxes?: number
    asking_price?: number
  }
  ai_call_analysis?: {
    motivation_score?: number
    urgency?: string
    property_condition?: string
    asking_price?: number
    concessions?: string[]
    objections?: string[]
    pain_points?: string[]
    rapport_level?: string
  }
  qualification?: {
    timeline?: string
    condition?: string
    motivation?: string
    price?: string
  }
}

function analyzeManifest(manifest: ManifestData, props: FavoriteOrFoolProps): {
  score: number
  verdict: string
  reasons: string[]
  color: string
} {
  let score = 5
  const reasons: string[] = []

  // Motivation (from AI analysis or manifest)
  const motivation = manifest.ai_call_analysis?.motivation_score ?? props.motivationScore
  if (motivation != null) {
    if (motivation >= 8) { score += 2; reasons.push(`High motivation (${motivation}/10)`) }
    else if (motivation >= 6) { score += 1; reasons.push(`Moderate motivation (${motivation}/10)`) }
    else if (motivation <= 3) { score -= 2; reasons.push(`Low motivation (${motivation}/10) — unlikely seller`) }
  }

  // Urgency/Timeline
  const timeline = manifest.qualification?.timeline || manifest.owner?.timeline || manifest.ai_call_analysis?.urgency
  if (timeline) {
    const t = timeline.toLowerCase()
    if (t.includes('immediate') || t.includes('asap') || t.includes('urgent') || t.includes('30 day')) {
      score += 1.5; reasons.push('Urgent timeline — wants to move fast')
    } else if (t.includes('6 month') || t.includes('year') || t.includes('not sure')) {
      score -= 1; reasons.push('Long timeline — not urgent')
    }
  }

  // Equity check
  const arv = props.arv
  const totalDebt = (manifest.financials?.mortgage_balance ?? 0) + (manifest.financials?.liens_amount ?? 0) + (manifest.financials?.back_taxes ?? 0)
  if (arv && arv > 0 && totalDebt > 0) {
    const equity = arv - totalDebt
    const equityPct = (equity / arv) * 100
    if (equityPct > 40) { score += 2; reasons.push(`Strong equity (${Math.round(equityPct)}%)`) }
    else if (equityPct > 20) { score += 1; reasons.push(`Decent equity (${Math.round(equityPct)}%)`) }
    else if (equityPct < 5) { score -= 2; reasons.push(`Little/no equity (${Math.round(equityPct)}%) — hard to make a deal`) }
  } else if (arv && props.offerAmount && arv > 0) {
    const spread = arv - props.offerAmount
    if (spread > arv * 0.3) { score += 1.5; reasons.push('Good spread between ARV and offer') }
    else if (spread < 0) { score -= 2; reasons.push('Offer exceeds ARV — no deal here') }
  }

  // Property condition
  const condition = manifest.property?.condition || manifest.ai_call_analysis?.property_condition || manifest.qualification?.condition
  if (condition) {
    const c = condition.toLowerCase()
    if (c.includes('poor') || c.includes('bad') || c.includes('needs work') || c.includes('distress')) {
      score += 0.5; reasons.push('Distressed property — motivated to sell')
    }
  }

  // Pain points from AI analysis
  const painPoints = manifest.ai_call_analysis?.pain_points
  if (painPoints && painPoints.length >= 2) {
    score += 1; reasons.push(`Multiple pain points identified (${painPoints.length})`)
  }

  // Reason for selling
  const reason = manifest.owner?.reasonForSelling || manifest.ai_call_analysis?.concessions?.join(', ')
  if (reason) {
    const r = reason.toLowerCase()
    if (r.includes('foreclose') || r.includes('divorce') || r.includes('death') || r.includes('relocat') || r.includes('behind on')) {
      score += 1; reasons.push('Life event driving sale — likely flexible')
    }
  }

  // Stage advancement
  const stageBonus: Record<string, number> = {
    contract_signed: 1.5, negotiations: 1, appt_set: 0.5, qualifying: 0.2, dead: -3,
  }
  score += stageBonus[props.station || ''] ?? 0

  // Rapport
  const rapport = manifest.ai_call_analysis?.rapport_level
  if (rapport) {
    const r = rapport.toLowerCase()
    if (r.includes('strong') || r.includes('high') || r.includes('excellent')) {
      score += 0.5; reasons.push('Strong rapport built')
    } else if (r.includes('hostile') || r.includes('cold') || r.includes('poor')) {
      score -= 1; reasons.push('Poor rapport — may not work with us')
    }
  }

  score = Math.round(Math.min(10, Math.max(0, score)) * 10) / 10

  let verdict: string
  let color: string
  if (score >= 8) { verdict = 'FAVORITE — Strong deal, high confidence'; color = '#22c55e' }
  else if (score >= 6) { verdict = 'PROMISING — Deal potential, keep pushing'; color = '#84cc16' }
  else if (score >= 4) { verdict = 'MAYBE — Needs more qualification'; color = '#eab308' }
  else if (score >= 2) { verdict = 'UNLIKELY — Low equity or motivation'; color = '#f97316' }
  else { verdict = 'FOOL — No deal here, move on'; color = '#ef4444' }

  if (reasons.length === 0) reasons.push('Not enough manifest data to assess — gather more info')

  return { score, verdict, reasons, color }
}

export function FavoriteOrFool({ leadId, manifestId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation }: FavoriteOrFoolProps) {
  const [manifest, setManifest] = useState<ManifestData>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchManifest() {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('manifests')
        .select('manifest')
        .eq('lead_id', leadId)
        .limit(1)
        .maybeSingle()
      if (data?.manifest) setManifest(data.manifest as ManifestData)
      setLoading(false)
    }
    fetchManifest()
  }, [leadId])

  const { score, verdict, reasons, color } = analyzeManifest(manifest, {
    leadId, manifestId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation,
  })
  const pct = (score / 10) * 100

  if (loading) {
    return (
      <section className="bg-[#1B2A4A] rounded-2xl p-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Analyzing deal...</span>
        </div>
      </section>
    )
  }

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
          Favorite or Fool?
        </h2>
      </div>

      {/* Score */}
      <div className="flex items-end gap-2 mb-3">
        <span className="text-5xl font-black leading-none" style={{ color }}>
          {score.toFixed(1)}
        </span>
        <span className="text-sm text-slate-400 mb-1">/ 10</span>
      </div>

      {/* Gauge Bar */}
      <div className="relative h-3 rounded-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500 mb-3 overflow-visible">
        <div
          className="absolute top-1/2 w-4 h-4 rounded-full border-2 border-white shadow-lg transition-all duration-700"
          style={{ left: `${pct}%`, backgroundColor: color, transform: 'translate(-50%, -50%)' }}
        />
      </div>

      {/* Verdict */}
      <p className="text-sm font-bold mb-3" style={{ color }}>{verdict}</p>

      {/* Reasons from manifest analysis */}
      <ul className="space-y-1.5 mb-3">
        {reasons.map((r, i) => (
          <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
            <span className="text-slate-500 mt-0.5">•</span>
            {r}
          </li>
        ))}
      </ul>

      {/* Data source indicator */}
      <p className="text-[9px] text-slate-500">
        Based on manifest data, call analysis, and lead financials
      </p>
    </section>
  )
}
