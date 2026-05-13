// Ari Briefing — AI intelligence summary for each lead
// Collapsed: 1-line snippet per section (Situation, Motivation, Strategy)
// Expanded (double-click): Full paragraphs for all 3 sections

'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { useCardCollapse } from '@/hooks/use-card-collapse'

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
  generatedAt?: string
}

export function AriBriefing({ leadId, manifestId, notes, sellerSituation, motivationScore, activities }: AriBriefingProps) {
  const [briefing, setBriefing] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(false)
  const [cached, setCached] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [open, toggleOpen] = useCardCollapse('ari-briefing')
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    function bump() { setRefreshTick((t) => t + 1) }
    window.addEventListener('crm:lead-refresh', bump)
    return () => window.removeEventListener('crm:lead-refresh', bump)
  }, [])

  // Re-generate when manifestId or leadId changes OR the lead page broadcasts a refresh
  useEffect(() => {
    const controller = new AbortController()
    buildBriefing(controller.signal)
    return () => controller.abort()
  }, [leadId, manifestId, refreshTick])

  function sanitizeBriefing(data: any): BriefingData | null {
    if (!data) return null
    let { situation, motivation, strategy } = data

    // Helper to clean a field value
    const cleanField = (value: any, fieldName: string): string => {
      if (!value) return ''
      let str = String(value).trim()

      // If it's stringified JSON, try to extract the inner value
      if (str.startsWith('{')) {
        try {
          const parsed = JSON.parse(str)
          // If it's a nested object with the same key, unwrap it
          const keys = Object.keys(parsed)
          if (keys.length === 1 && typeof parsed[keys[0]] === 'string') {
            return parsed[keys[0]]
          }
          // If it has the field name as a key, extract it
          if (parsed[fieldName] && typeof parsed[fieldName] === 'string') {
            return parsed[fieldName]
          }
        } catch { /* not valid JSON, use as-is */ }
      }

      // Remove common JSON artifacts that slip through
      str = str.replace(/^\{"[^"]+"\s*:\s*"/, '').replace(/"\}$/, '')

      // Strip leading label prefix (e.g., "Situation: The homeowner..." → "The homeowner...")
      str = str.replace(new RegExp(`^${fieldName}\\s*[:\\-–—]\\s*`, 'i'), '')

      return str
    }

    situation = cleanField(situation, 'situation')
    motivation = cleanField(motivation, 'motivation')
    strategy = cleanField(strategy, 'strategy')

    if (!situation && !motivation && !strategy) return null
    return { situation, motivation, strategy }
  }

  async function buildBriefing(signal?: AbortSignal) {
    if (manifestId) {
      try {
        setLoading(true)
        const res = await fetch(`/api/ari/generate-briefing?manifestId=${manifestId}`, { signal })
        if (res.ok) {
          const raw = await res.json()
          const data = sanitizeBriefing(raw)
          if (data) {
            setBriefing(data)
            setCached(raw.cached || false)
            setGeneratedAt(raw.generatedAt || null)
            setLoading(false)
            return
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return // cancelled — don't touch state
        console.error('Manifest briefing error:', err)
      }
      setLoading(false)
      return
    }

    // No manifest yet — use notes/activities for legacy briefing
    const callActivities = activities?.filter(a => a.activity_type === 'call') || []
    const noteActivities = activities?.filter(a => a.activity_type === 'note' || a.activity_type === 'agent_note') || []
    const allNotes = [
      notes, sellerSituation,
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
        body: JSON.stringify({ leadId, notes: allNotes, motivationScore, sellerSituation, callCount: callActivities.length }),
        signal,
      })
      if (res.ok) {
        const raw = await res.json()
        const data = sanitizeBriefing(raw)
        if (data) { setBriefing(data); setCached(false); setLoading(false); return }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
    }

    // Offline fallback — build from local data
    const situation = sellerSituation || (notes ? notes.slice(0, 200) : 'No detailed situation data available yet.')
    const motivationText = motivationScore
      ? motivationScore >= 8 ? 'High motivation. Seller appears eager to move forward quickly.'
        : motivationScore >= 5 ? 'Moderate motivation. Seller interested but exploring options.'
        : 'Low motivation. Consider nurturing through periodic follow-up.'
      : 'Motivation not assessed yet.'
    const strategy = callActivities.length > 0
      ? `${callActivities.length} call(s) logged. Continue building rapport.`
      : 'No calls yet. Priority: make initial contact.'
    setBriefing({ situation, motivation: motivationText, strategy })
    setLoading(false)
  }

  // Freshness indicator: green < 2min, yellow 2-15min, red > 15min
  function getFreshness(): { label: string; color: string; dotColor: string } | null {
    if (!generatedAt) return null
    const ageMs = Date.now() - new Date(generatedAt).getTime()
    const ageMin = Math.floor(ageMs / 60_000)

    if (ageMin < 1) return { label: 'Just now', color: 'text-green-400/80', dotColor: 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' }
    if (ageMin < 2) return { label: '1m ago', color: 'text-green-400/80', dotColor: 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' }
    if (ageMin < 15) return { label: `${ageMin}m ago`, color: 'text-yellow-400/80', dotColor: 'bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.6)]' }
    if (ageMin < 60) return { label: `${ageMin}m ago`, color: 'text-red-400/80', dotColor: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]' }
    const ageHrs = Math.floor(ageMin / 60)
    return { label: `${ageHrs}h ago`, color: 'text-red-400/80', dotColor: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]' }
  }

  // Get first sentence as snippet
  function snippet(text: string, maxLen = 90): string {
    if (!text) return ''
    const first = text.split(/[.!?]/)[0]
    if (first.length > maxLen) return first.slice(0, maxLen) + '...'
    return first + '.'
  }

  // Build a single-line synopsis (<10s read) from the 3-part briefing.
  function buildSynopsis(b: BriefingData): string {
    const sit = snippet(b.situation, 110).replace(/[.!?]$/, '')
    const mot = snippet(b.motivation, 90).replace(/[.!?]$/, '')
    const strat = snippet(b.strategy, 90).replace(/[.!?]$/, '')
    const parts: string[] = []
    if (sit) parts.push(sit)
    if (mot) parts.push(mot)
    if (strat) parts.push(`Next: ${strat}`)
    return parts.join('. ') + '.'
  }

  return (
    <section
      className="rounded-2xl p-5 relative overflow-hidden cursor-pointer select-none border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
      onDoubleClick={() => setExpanded(!expanded)}
      title={expanded ? 'Double-click to collapse' : 'Double-click to expand full briefing'}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between mb-4 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); toggleOpen() }}
      >
        <div className="flex items-center gap-2">
          <Icon name="auto_awesome" className="!text-base !text-[color:var(--ck-accent)]" />
          <h2 className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">Ari Briefing</h2>
        </div>
        <div className="flex items-center gap-2">
          {(() => {
            const freshness = getFreshness()
            return (
              <div className="flex items-center gap-1.5" title={generatedAt ? `Generated: ${new Date(generatedAt).toLocaleString()}` : ''}>
                <div className={`w-1.5 h-1.5 rounded-full ${freshness?.dotColor || 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]'}`} />
                <span className={`text-[10px] font-medium ${freshness?.color || 'text-green-400/80'}`}>
                  {freshness?.label || (cached ? 'Cached' : 'Live')}
                </span>
              </div>
            )
          })()}
          <button
            onClick={(e) => { e.stopPropagation(); buildBriefing() }}
            disabled={loading}
            title="Regenerate briefing"
            className="p-1 rounded bg-white/5 hover:bg-white/10 text-[color:var(--ck-text-dim)] hover:text-amber-400 transition-all disabled:opacity-30"
          >
            <Icon name="refresh" className={`!text-xs ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Icon
            name={open ? 'expand_less' : 'expand_more'}
            className="!text-base !text-[color:var(--ck-text-muted)]"
          />
        </div>
      </div>

      {!open ? null : loading ? (
        <div className="flex items-center gap-2 py-3">
          <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Analyzing lead data...</span>
        </div>
      ) : !briefing ? (
        <p className="text-sm text-slate-400 italic">
          No data yet. Add notes or log calls to generate briefing.
        </p>
      ) : expanded ? (
        /* ── EXPANDED: detailed breakdown of the entire situation ── */
        <div className="space-y-4">
          <div
            className="rounded-lg p-3 border"
            style={{ background: 'var(--ck-surface-elev)', borderColor: 'var(--ck-border)' }}
          >
            <p className="ck-microlabel mb-1.5 !text-[10px]" style={{ color: 'var(--ck-accent)' }}>
              Situation
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ck-text)' }}>
              {briefing.situation || 'No situation data yet.'}
            </p>
          </div>
          <div
            className="rounded-lg p-3 border"
            style={{ background: 'var(--ck-surface-elev)', borderColor: 'var(--ck-border)' }}
          >
            <p className="ck-microlabel mb-1.5 !text-[10px]" style={{ color: 'var(--ck-accent)' }}>
              Motivation
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ck-text)' }}>
              {briefing.motivation || 'No motivation data yet.'}
            </p>
          </div>
          <div
            className="rounded-lg p-3 border"
            style={{ background: 'var(--ck-surface-elev)', borderColor: 'var(--ck-border)' }}
          >
            <p className="ck-microlabel mb-1.5 !text-[10px]" style={{ color: 'var(--ck-accent)' }}>
              Strategy / Next Move
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ck-text)' }}>
              {briefing.strategy || 'No strategy yet.'}
            </p>
          </div>
        </div>
      ) : (
        /* ── SYNOPSIS: one-line, agent reads in <10s ── */
        <p
          className="text-sm leading-snug"
          style={{ color: 'var(--ck-text)' }}
        >
          {buildSynopsis(briefing)}
        </p>
      )}

      <p className="text-[9px] mt-3" style={{ color: 'var(--ck-text-dim)' }}>
        {expanded ? 'Double-click to collapse' : 'Double-click for full briefing'}
      </p>
    </section>
  )
}
