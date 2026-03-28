'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'

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

// Keywords to extract pain points from text
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
  'can\'t afford': { label: 'Cannot afford property expenses', period: 'present' },
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

function extractPainPoints(text: string): PainPoint[] {
  const lower = text.toLowerCase()
  const found: Map<string, { label: string; period: 'past' | 'present' | 'future' }> = new Map()

  for (const [keyword, info] of Object.entries(PAIN_KEYWORDS)) {
    if (lower.includes(keyword)) {
      found.set(info.label, info)
    }
  }

  const grouped: Record<string, string[]> = { past: [], present: [], future: [] }
  for (const [, info] of found) {
    grouped[info.period].push(info.label)
  }

  const result: PainPoint[] = []
  if (grouped.past.length > 0) result.push({ period: 'past', items: grouped.past })
  if (grouped.present.length > 0) result.push({ period: 'present', items: grouped.present })
  if (grouped.future.length > 0) result.push({ period: 'future', items: grouped.future })

  return result
}

const PERIOD_CONFIG = {
  past: { color: 'text-slate-400', dotBg: 'bg-slate-400', label: 'Past', icon: 'history' },
  present: { color: 'text-amber-400', dotBg: 'bg-amber-400', label: 'Present', icon: 'radio_button_checked' },
  future: { color: 'text-blue-400', dotBg: 'bg-blue-400', label: 'Future', icon: 'schedule' },
}

export function PainPoints({ leadId, notes, sellerSituation, motivationScore, activities }: PainPointsProps) {
  const [painPoints, setPainPoints] = useState<PainPoint[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Collect all text for analysis
    const texts: string[] = []
    if (notes) texts.push(notes)
    if (sellerSituation) texts.push(sellerSituation)
    activities?.forEach(a => {
      if (a.description) texts.push(a.description)
    })

    const allText = texts.join(' ')

    if (!allText) {
      setPainPoints([])
      return
    }

    // Try API extraction first
    tryApiExtraction(allText)
  }, [leadId, notes, sellerSituation, activities])

  async function tryApiExtraction(text: string) {
    // Local extraction first (instant)
    const local = extractPainPoints(text)

    // Try API for richer extraction
    try {
      setLoading(true)
      const res = await fetch('/api/ari/extract-pain-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, motivationScore }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.painPoints && data.painPoints.length > 0) {
          setPainPoints(data.painPoints)
          setLoading(false)
          return
        }
      }
    } catch {
      // Fall through to local
    }

    // Use local extraction
    setPainPoints(local.length > 0 ? local : generateDefaultPainPoints(text))
    setLoading(false)
  }

  function generateDefaultPainPoints(text: string): PainPoint[] {
    // If we have text but no keyword matches, create generic entries
    if (!text) return []
    const result: PainPoint[] = []
    
    if (motivationScore && motivationScore >= 7) {
      result.push({ period: 'present', items: ['High motivation detected - seller appears ready to act'] })
    }
    if (text.length > 20) {
      result.push({ period: 'present', items: ['Situation details available - review notes for specifics'] })
    }
    
    return result
  }

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-5">
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
        <div className="space-y-5 relative">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-white/10" />

          {painPoints.map((point) => {
            const config = PERIOD_CONFIG[point.period]
            return (
              <div key={point.period} className="relative pl-8">
                {/* Timeline dot */}
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
