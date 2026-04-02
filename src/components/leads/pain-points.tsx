// Seller Pain Points — Past / Present / Future timeline
// Pulls structured data from manifest first, then falls back to keyword extraction

'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'

interface PainPoint {
  period: 'past' | 'present' | 'future'
  items: string[]
}

interface PainPointsProps {
  leadId: string
  notes?: string | null
  sellerSituation?: string | null
  motivationScore?: number | null
  activities?: Array<{
    activity_type: string
    description: string | null
    metadata: Record<string, unknown> | null
  }>
}

// Keywords for fallback extraction from raw text
const PAIN_KEYWORDS: Record<string, { label: string; period: 'past' | 'present' | 'future' }> = {
  'behind on payments': { label: 'Behind on mortgage payments', period: 'present' },
  'late on mortgage': { label: 'Behind on mortgage payments', period: 'present' },
  'foreclosure': { label: 'Facing foreclosure', period: 'future' },
  'pre-foreclosure': { label: 'In pre-foreclosure', period: 'present' },
  'divorce': { label: 'Going through divorce', period: 'present' },
  'divorced': { label: 'Divorce settlement', period: 'past' },
  'inherited': { label: 'Inherited property', period: 'past' },
  'death': { label: 'Death in family', period: 'past' },
  'passed away': { label: 'Family member passed away', period: 'past' },
  "can't afford": { label: 'Cannot afford property expenses', period: 'present' },
  'cant afford': { label: 'Cannot afford property expenses', period: 'present' },
  'repairs': { label: 'Property needs significant repairs', period: 'present' },
  'code violations': { label: 'Code violations on property', period: 'present' },
  'vacant': { label: 'Property is vacant', period: 'present' },
  'moving': { label: 'Relocating / needs to move', period: 'future' },
  'relocat': { label: 'Relocating to new area', period: 'future' },
  'job loss': { label: 'Job loss / income reduction', period: 'past' },
  'lost job': { label: 'Job loss / income reduction', period: 'past' },
  'tax lien': { label: 'Tax liens on property', period: 'present' },
  'delinquent': { label: 'Tax delinquency', period: 'present' },
  'back taxes': { label: 'Owes back taxes', period: 'present' },
  'medical': { label: 'Medical bills / health issues', period: 'present' },
  'hospital': { label: 'Medical emergency expenses', period: 'past' },
  'retirement': { label: 'Downsizing for retirement', period: 'future' },
  'downsize': { label: 'Looking to downsize', period: 'future' },
  'tired landlord': { label: 'Tired of being a landlord', period: 'present' },
  'bad tenant': { label: 'Problem tenant issues', period: 'present' },
  'eviction': { label: 'Dealing with eviction', period: 'present' },
  'probate': { label: 'Property in probate', period: 'present' },
  'bankruptcy': { label: 'Considering or in bankruptcy', period: 'present' },
  'upside down': { label: 'Underwater on mortgage', period: 'present' },
  'hoa': { label: 'HOA issues or fees', period: 'present' },
}

function extractFromText(text: string): PainPoint[] {
  const lower = text.toLowerCase()
  const found: Map<string, { label: string; period: 'past' | 'present' | 'future' }> = new Map()
  for (const [keyword, info] of Object.entries(PAIN_KEYWORDS)) {
    if (lower.includes(keyword)) found.set(info.label, info)
  }
  const grouped: Record<string, string[]> = { past: [], present: [], future: [] }
  for (const [, info] of found) grouped[info.period].push(info.label)
  const result: PainPoint[] = []
  if (grouped.past.length) result.push({ period: 'past', items: grouped.past })
  if (grouped.present.length) result.push({ period: 'present', items: grouped.present })
  if (grouped.future.length) result.push({ period: 'future', items: grouped.future })
  return result
}

// Map manifest situation types to pain points
const SITUATION_TYPE_MAP: Record<string, { label: string; period: 'past' | 'present' | 'future' }> = {
  tax_delinquent: { label: 'Tax delinquent', period: 'present' },
  inherited: { label: 'Inherited property', period: 'past' },
  probate: { label: 'Property in probate', period: 'present' },
  foreclosure: { label: 'Facing foreclosure', period: 'future' },
  pre_foreclosure: { label: 'In pre-foreclosure', period: 'present' },
  divorce: { label: 'Going through divorce', period: 'present' },
  vacant: { label: 'Property is vacant', period: 'present' },
  absentee: { label: 'Absentee owner', period: 'present' },
  code_violation: { label: 'Code violations', period: 'present' },
  distressed: { label: 'Distressed property', period: 'present' },
  behind_on_payments: { label: 'Behind on payments', period: 'present' },
  relocation: { label: 'Needs to relocate', period: 'future' },
  deceased_owner: { label: 'Owner deceased', period: 'past' },
  tired_landlord: { label: 'Tired of being landlord', period: 'present' },
  downsizing: { label: 'Looking to downsize', period: 'future' },
}

export function PainPoints({ leadId, notes, sellerSituation, motivationScore, activities }: PainPointsProps) {
  const [painPoints, setPainPoints] = useState<PainPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function analyze() {
      setLoading(true)
      const grouped: Record<string, Set<string>> = { past: new Set(), present: new Set(), future: new Set() }

      // 1. Pull from manifest (structured data — most reliable)
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('manifests')
          .select('manifest')
          .eq('lead_id', leadId)
          .limit(1)
          .maybeSingle()

        const m = data?.manifest as any
        if (m) {
          // Situation types
          const types: string[] = m.situation?.type || []
          for (const t of types) {
            const mapped = SITUATION_TYPE_MAP[t]
            if (mapped) grouped[mapped.period].add(mapped.label)
          }

          // Motivation signals
          const signals: string[] = m.situation?.motivation?.signals || []
          for (const sig of signals) {
            grouped.present.add(sig)
          }

          // Secondary motivations
          const secondary: string[] = m.situation?.motivation?.secondary || []
          for (const sec of secondary) {
            grouped.present.add(sec)
          }

          // Red flags
          const redFlags: string[] = m.flags?.redFlags || []
          for (const rf of redFlags) {
            grouped.present.add(rf)
          }

          // Opportunity flags
          const oppFlags: string[] = m.flags?.opportunityFlags || []
          for (const of_ of oppFlags) {
            const mapped = SITUATION_TYPE_MAP[of_]
            if (mapped) grouped[mapped.period].add(mapped.label)
          }

          // Deceased owner
          if (m.owner?.deceased) grouped.past.add('Owner deceased')

          // Vacant
          if (m.property?.vacant) grouped.present.add('Property is vacant')

          // Out of state
          if (m.owner?.outOfState) grouped.present.add('Absentee / out-of-state owner')

          // Tax delinquent
          if (m.property?.taxCollector?.delinquentAmount) {
            const amt = m.property.taxCollector.delinquentAmount
            grouped.present.add(`Tax delinquent ($${Number(amt).toLocaleString()} owed)`)
          }

          // Objections
          const objections: string[] = m.situation?.objections || []
          for (const obj of objections) {
            grouped.present.add(`Objection: ${obj}`)
          }

          // Blockers
          const blockers: string[] = m.situation?.blockers || []
          for (const b of blockers) {
            grouped.future.add(`Blocker: ${b}`)
          }

          // Call transcript pain points
          const transcripts = m.communications?.transcripts || []
          for (const t of transcripts) {
            const painPts: string[] = t.extractedData?.painPoints || t.extractedData?.pain_points || []
            for (const pp of painPts) {
              grouped.present.add(pp)
            }
          }
        }
      } catch { /* silent */ }

      // 2. Keyword extraction from notes/activities (fallback)
      const texts: string[] = []
      if (notes) texts.push(notes)
      if (sellerSituation) texts.push(sellerSituation)
      activities?.forEach(a => { if (a.description) texts.push(a.description) })
      const allText = texts.join(' ')

      if (allText) {
        const textPoints = extractFromText(allText)
        for (const tp of textPoints) {
          for (const item of tp.items) {
            grouped[tp.period].add(item)
          }
        }
      }

      // Build final list
      const result: PainPoint[] = []
      if (grouped.past.size) result.push({ period: 'past', items: [...grouped.past] })
      if (grouped.present.size) result.push({ period: 'present', items: [...grouped.present] })
      if (grouped.future.size) result.push({ period: 'future', items: [...grouped.future] })

      setPainPoints(result)
      setLoading(false)
    }

    if (leadId) analyze()
  }, [leadId, notes, sellerSituation, motivationScore, activities])

  const PERIOD_CONFIG = {
    past: { color: 'text-slate-400', dotBg: 'bg-slate-400', label: 'Past', icon: 'history' },
    present: { color: 'text-amber-400', dotBg: 'bg-amber-400', label: 'Present', icon: 'radio_button_checked' },
    future: { color: 'text-blue-400', dotBg: 'bg-blue-400', label: 'Future', icon: 'schedule' },
  }

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="psychology_alt" className="!text-lg text-rose-400" />
        <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
          Seller Pain Points
        </h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3">
          <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Analyzing...</span>
        </div>
      ) : painPoints.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          No pain points identified yet. Add notes or log calls to detect seller motivations.
        </p>
      ) : (
        <div className="space-y-4 relative">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-white/10" />

          {painPoints.map((point) => {
            const config = PERIOD_CONFIG[point.period]
            return (
              <div key={point.period} className="relative pl-8">
                <div className={`absolute left-0 top-1 w-6 h-6 rounded-full border-2 border-[#1B2A4A] flex items-center justify-center ${config.dotBg}`}>
                  <div className="w-2 h-2 rounded-full bg-[#1B2A4A]" />
                </div>
                <p className={`text-[10px] font-black uppercase tracking-wider mb-1.5 ${config.color}`}>
                  {config.label}
                </p>
                <ul className="space-y-1">
                  {point.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Icon name="chevron_right" className="!text-xs text-slate-500 mt-0.5 shrink-0" />
                      <span className="text-sm text-slate-300">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
