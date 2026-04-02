// Seller Goals — Simple display of what the seller wants
// Pulls from manifest (situation.motivation, priceExpectations, timeline)
// and from call analyzer extracted data

'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'

interface SellerGoalsProps {
  leadId: string
  notes?: string | null
  sellerSituation?: string | null
  activities?: Array<{
    activity_type: string
    description: string | null
    metadata: Record<string, unknown> | null
  }>
}

interface GoalItem {
  icon: string
  label: string
  value: string
}

export function SellerGoals({ leadId, notes, sellerSituation, activities }: SellerGoalsProps) {
  const [goals, setGoals] = useState<GoalItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function extract() {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('manifests')
        .select('manifest')
        .eq('lead_id', leadId)
        .limit(1)
        .maybeSingle()

      const m = data?.manifest as any
      const extracted: GoalItem[] = []

      // What they want (primary motivation / reason for selling)
      const primary = m?.situation?.motivation?.primary
      if (primary) {
        extracted.push({ icon: 'flag', label: 'Primary Goal', value: primary })
      }

      // Price expectations
      const asking = m?.situation?.priceExpectations?.sellerAsking ||
        m?.situation?.priceExpectations?.askingPrice ||
        m?.financials?.asking_price
      if (asking) {
        extracted.push({ icon: 'payments', label: 'Wants', value: `$${Number(asking).toLocaleString()}` })
      }

      const floor = m?.situation?.priceExpectations?.sellerFloor ||
        m?.situation?.priceExpectations?.minimumAcceptable
      if (floor) {
        extracted.push({ icon: 'arrow_downward', label: 'Will Accept', value: `$${Number(floor).toLocaleString()}` })
      }

      // Timeline
      const timeline = m?.situation?.timeline?.urgency ||
        m?.situation?.timeline?.preferredClosing
      if (timeline) {
        extracted.push({ icon: 'schedule', label: 'Timeline', value: timeline })
      }

      // What matters to them (speed vs price vs convenience)
      const flexibility = m?.situation?.priceExpectations?.priceFlexibility
      if (flexibility) {
        extracted.push({ icon: 'tune', label: 'Price Flexibility', value: flexibility })
      }

      // Preferred closing / terms
      const closingPref = m?.situation?.timeline?.preferredClosing
      if (closingPref && closingPref !== timeline) {
        extracted.push({ icon: 'event', label: 'Preferred Close', value: closingPref })
      }

      // Blockers
      const blockers = m?.situation?.blockers
      if (blockers?.length) {
        extracted.push({ icon: 'block', label: 'Blockers', value: blockers.join(', ') })
      }

      // From call transcripts — extracted seller quotes about what they want
      const transcripts = m?.communications?.transcripts || []
      for (const t of transcripts) {
        const ex = t.extractedData
        if (ex?.sellerAsking && !asking) {
          extracted.push({ icon: 'payments', label: 'Wants', value: `$${Number(ex.sellerAsking).toLocaleString()}` })
        }
        if (ex?.urgency && !timeline) {
          extracted.push({ icon: 'schedule', label: 'Timeline', value: ex.urgency })
        }
      }

      // Fallback: scan notes for goal-related keywords
      if (extracted.length === 0) {
        const allText = [notes, sellerSituation,
          ...(activities?.map(a => a.description) || [])
        ].filter(Boolean).join(' ').toLowerCase()

        if (allText.includes('quick') || allText.includes('fast') || allText.includes('asap')) {
          extracted.push({ icon: 'bolt', label: 'Priority', value: 'Wants a fast close' })
        }
        if (allText.includes('cash') || allText.includes('all cash')) {
          extracted.push({ icon: 'payments', label: 'Preference', value: 'Cash offer preferred' })
        }
        if (allText.includes('relocat') || allText.includes('moving')) {
          extracted.push({ icon: 'flight', label: 'Situation', value: 'Relocating — needs to sell' })
        }
        if (allText.includes('repair') || allText.includes('as-is') || allText.includes('as is')) {
          extracted.push({ icon: 'handyman', label: 'Condition', value: 'Wants to sell as-is' })
        }
      }

      setGoals(extracted)
      setLoading(false)
    }

    if (leadId) extract()
  }, [leadId, notes, sellerSituation, activities])

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="emoji_objects" className="!text-lg text-cyan-400" />
        <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
          Seller Goals
        </h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2">
          <div className="w-3 h-3 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Loading...</span>
        </div>
      ) : goals.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          No seller goals identified yet. More data needed from calls or notes.
        </p>
      ) : (
        <div className="space-y-2.5">
          {goals.map((g, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <Icon name={g.icon} className="!text-sm text-cyan-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.label}</span>
                <p className="text-sm text-slate-200 font-medium leading-snug">{g.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
