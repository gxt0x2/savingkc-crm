// Ari Briefing — AI intelligence summary for each lead
// Collapsed: 1-2 sentence situation summary
// Expanded (click): All 3 sections — Situation, Motivation, Strategy

'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'

interface AriBriefingProps {
  leadId: string
  manifestId?: string
  personalityType?: string | null
  tacticalApproach?: string | null
  notes?: string | null
  sellerSituation?: string | null
  motivationScore?: number | null
  activities?: Array<{
    activity_type: string
    description: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }>
}

interface BriefingData {
  situation: string
  motivation: string
  strategy: string
}

export function AriBriefing({ leadId, manifestId, notes, sellerSituation, motivationScore, activities }: AriBriefingProps) {
  const [briefing, setBriefing] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(false)
  const [cached, setCached] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    buildBriefing()
  }, [leadId, manifestId, notes, sellerSituation, motivationScore, activities])

  // Parse briefing fields that may contain raw JSON strings (LLM quirk)
  function sanitizeBriefing(data: any): BriefingData | null {
    if (!data) return null
    let { situation, motivation, strategy } = data

    if (typeof situation === 'string' && situation.trimStart().startsWith('{')) {
      try {
        const inner = JSON.parse(situation)
        if (inner.situation) {
          situation = inner.situation
          motivation = inner.motivation || motivation
          strategy = inner.strategy || strategy
        }
      } catch { /* not JSON, use as-is */ }
    }

    if (!situation && !motivation && !strategy) return null
    return {
      situation: situation || '',
      motivation: motivation || '',
      strategy: strategy || '',
    }
  }

  async function buildBriefing() {
    // Manifest-based briefing (primary path)
    if (manifestId) {
      try {
        setLoading(true)
        const res = await fetch(`/api/ari/generate-briefing?manifestId=${manifestId}`)
        if (res.ok) {
          const raw = await res.json()
          const data = sanitizeBriefing(raw)
          if (data) {
            setBriefing(data)
            setCached(raw.cached || false)
            setLoading(false)
            return
          }
        }
      } catch (err) {
        console.error('Manifest briefing error:', err)
      }
      setLoading(false)
      return
    }

    // Legacy mode: collect all data points
    const callActivities = activities?.filter(a => a.activity_type === 'call') || []
    const noteActivities = activities?.filter(a => a.activity_type === 'note' || a.activity_type === 'agent_note') || []
    const allNotes = [
      notes,
      sellerSituation,
      ...callActivities.map(a => a.description),
      ...noteActivities.map(a => a.description),
    ].filter(Boolean).join(' | ')

    if (!allNotes && !motivationScore) {
      setBriefing(null)
      return
    }

    try {
      setLoading(true)
      const res = await fetch('/api/ari/generate-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          notes: allNotes,
          motivationScore,
          sellerSituation,
          callCount: callActivities.length,
        }),
      })
      if (res.ok) {
        const raw = await res.json()
        const data = sanitizeBriefing(raw)
        if (data) {
          setBriefing(data)
          setCached(false)
          setLoading(false)
          return
        }
      }
    } catch {
      // Fall through to local generation
    }

    // Local fallback
    const situation = sellerSituation || (notes ? notes.slice(0, 200) : 'No detailed situation data available yet.')
    const motivationText = motivationScore
      ? motivationScore >= 8 ? 'High motivation. Seller appears eager to move forward quickly.'
        : motivationScore >= 5 ? 'Moderate motivation. Seller is interested but may be exploring options.'
        : 'Low motivation at this time. Consider nurturing through periodic follow-up.'
      : 'Motivation level has not been assessed yet.'
    const strategy = callActivities.length > 0
      ? `${callActivities.length} call(s) logged. Continue building rapport and address seller concerns directly.`
      : 'No calls recorded yet. Priority: make initial contact to assess situation.'

    setBriefing({ situation, motivation: motivationText, strategy })
    setLoading(false)
  }

  // Collapsed: first 1-2 sentences
  function getCollapsedText(text: string): string {
    // Get first two sentences
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text]
    const preview = sentences.slice(0, 2).join(' ').trim()
    if (preview.length > 180) return preview.slice(0, 180) + '...'
    return preview || text.slice(0, 180) + '...'
  }

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-5 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <h2 className="text-sm font-black text-white">Ari Briefing</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
            <span className="text-[10px] text-green-400/80 font-medium">
              {cached ? 'Cached' : 'Live'}
            </span>
          </div>
          <button
            onClick={() => buildBriefing()}
            disabled={loading}
            title="Refresh"
            className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/40 hover:text-amber-400 transition-all disabled:opacity-30"
          >
            <Icon name="refresh" className={`!text-xs ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3">
          <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Analyzing lead data...</span>
        </div>
      ) : !briefing ? (
        <p className="text-sm text-slate-400 italic">
          No data yet. Add notes or log calls to generate briefing.
        </p>
      ) : expanded ? (
        /* ── Expanded: all 3 sections ── */
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-200 leading-relaxed">
              <span className="font-bold text-white">Situation: </span>
              {briefing.situation}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-200 leading-relaxed">
              <span className="font-bold text-amber-400">Motivation: </span>
              {briefing.motivation}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-200 leading-relaxed">
              <span className="font-bold text-green-400">Strategy: </span>
              {briefing.strategy}
            </p>
          </div>
        </div>
      ) : (
        /* ── Collapsed: 1-2 sentence summary ── */
        <p className="text-sm text-slate-300 leading-relaxed">
          {getCollapsedText(briefing.situation)}
        </p>
      )}

      {/* Toggle */}
      {briefing && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-[10px] text-amber-400/70 hover:text-amber-400 font-bold uppercase tracking-wider transition-colors"
        >
          {expanded ? '← Collapse' : '→ Full briefing'}
        </button>
      )}
    </section>
  )
}
