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

export function AriBriefing({ leadId, manifestId, personalityType, tacticalApproach, notes, sellerSituation, motivationScore, activities }: AriBriefingProps) {
  const [briefing, setBriefing] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [cached, setCached] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Build briefing from available data
  useEffect(() => {
    buildBriefing()
  }, [leadId, manifestId, notes, sellerSituation, motivationScore, activities])

  async function buildBriefing() {
    // If manifestId provided, use manifest-based briefing
    if (manifestId) {
      try {
        setLoading(true)
        const res = await fetch(`/api/ari/generate-briefing?manifestId=${manifestId}`)
        if (res.ok) {
          const data = await res.json()
          if (data.situation || data.motivation || data.strategy) {
            setBriefing(data)
            setCached(data.cached || false)
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
      // No data yet - show waiting state
      setBriefing(null)
      return
    }

    // Try API-based briefing generation
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
        const data = await res.json()
        if (data.situation || data.motivation || data.strategy) {
          setBriefing(data)
          setCached(false)
          setLoading(false)
          return
        }
      }
    } catch {
      // Fall through to local generation
    }

    // Local fallback: construct from available data
    const situation = sellerSituation || (notes ? notes.slice(0, 200) : 'No detailed situation data available yet. More information will be gathered during follow-up conversations.')
    
    const motivationText = motivationScore
      ? motivationScore >= 8 ? 'Seller shows high motivation. They appear eager to move forward quickly and are likely facing time pressure or financial constraints.'
        : motivationScore >= 5 ? 'Moderate motivation detected. Seller is interested but may be exploring options. Continued engagement recommended.'
        : 'Low motivation at this time. Seller may not be ready to act. Consider nurturing through periodic follow-up.'
      : 'Motivation level has not been assessed yet. Recommend direct conversation to gauge urgency.'

    const strategy = callActivities.length > 0
      ? `${callActivities.length} call(s) logged. Continue building rapport and address seller concerns directly. Focus on understanding their timeline and pain points.`
      : 'No calls recorded yet. Priority action: make initial contact to assess situation and build rapport.'

    setBriefing({
      situation,
      motivation: motivationText,
      strategy,
    })
    setLoading(false)
  }

  // Helper to truncate situation to ~120 chars (first sentence)
  const getCondensedSituation = (text: string): string => {
    const firstSentence = text.split(/[.!?]/)[0]
    if (firstSentence.length > 120) {
      return firstSentence.slice(0, 120) + '...'
    }
    return firstSentence + '...'
  }

  return (
    <>
      <section
        className="bg-[#1B2A4A] rounded-2xl p-6 relative overflow-hidden cursor-pointer"
        onDoubleClick={() => setExpanded(!expanded)}
        title={expanded ? "Double-click to collapse" : "Double-click to expand"}
      >
        {/* Subtle glow effect */}
        <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500 opacity-[0.04] blur-[80px]" />

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Icon name="psychology" className="!text-lg text-amber-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
              Ari Briefing
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
              <span className="text-[10px] text-green-400/80 font-medium">
                {cached ? 'Cached' : 'Live Analysis'}
              </span>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); buildBriefing() }}
            disabled={loading}
            title="Refresh Ari briefing"
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-amber-400 transition-all disabled:opacity-30"
          >
            <Icon name="refresh" className={`!text-sm ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4">
            <div className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
            <span className="text-sm text-slate-400">Analyzing lead data...</span>
          </div>
        ) : !briefing ? (
          <p className="text-sm text-slate-400 italic py-2">
            Waiting for more information. Add notes or log calls to generate Ari analysis.
          </p>
        ) : expanded ? (
          <div className="space-y-4">
            {/* Situation */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon name="info" className="!text-xs text-blue-400" />
                <p className="text-[10px] font-black uppercase tracking-wider text-blue-400">
                  Situation
                </p>
              </div>
              <p className="text-sm leading-relaxed text-slate-300">
                {briefing.situation}
              </p>
            </div>

            {/* Motivation */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon name="trending_up" className="!text-xs text-amber-400" />
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                  Motivation
                </p>
              </div>
              <p className="text-sm leading-relaxed text-slate-300">
                {briefing.motivation}
              </p>
            </div>

            {/* Strategy */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon name="target" className="!text-xs text-green-400" />
                <p className="text-[10px] font-black uppercase tracking-wider text-green-400">
                  Strategy
                </p>
              </div>
              <p className="text-sm leading-relaxed text-slate-300">
                {briefing.strategy}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm leading-relaxed text-slate-300">
              {getCondensedSituation(briefing.situation)}
            </p>
          </div>
        )}

        <p className="text-[9px] text-slate-500 mt-4">
          {expanded ? 'Double-click to collapse' : '→ full briefing'}
        </p>
      </section>

      {/* Drawer */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setDrawerOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 w-[480px] max-w-full bg-[#1B2A4A] shadow-2xl z-50 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Icon name="psychology" className="text-amber-400" />
                <h2 className="text-lg font-bold text-white">Full Ari Briefing</h2>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <Icon name="close" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {briefing && (
                <>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-blue-400 mb-2">Situation</h3>
                    <p className="text-sm text-slate-300 leading-relaxed">{briefing.situation}</p>
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-amber-400 mb-2">Motivation</h3>
                    <p className="text-sm text-slate-300 leading-relaxed">{briefing.motivation}</p>
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-green-400 mb-2">Strategy</h3>
                    <p className="text-sm text-slate-300 leading-relaxed">{briefing.strategy}</p>
                  </div>
                </>
              )}

              {/* All notes/activities */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">Activity History</h3>
                <div className="space-y-3">
                  {activities && activities.length > 0 ? activities.map((a, i) => (
                    <div key={i} className="text-sm">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">{a.activity_type}</span>
                        <span className="text-[10px] text-slate-600">{new Date(a.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-slate-300">{a.description || 'No description'}</p>
                    </div>
                  )) : (
                    <p className="text-sm text-slate-500 italic">No activities recorded yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
