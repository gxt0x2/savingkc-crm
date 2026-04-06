'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import type { HotScoreBreakdown } from '@/types/hot-opportunity'

interface AuditEntry {
  composite_score: number
  engagement_score: number
  velocity_score: number
  deal_quality_score: number
  time_pressure_score: number
  multiplier: number
  tier_label: string
  tier_capped: boolean
  trigger_event: string | null
  raw_inputs: any
  created_at: string
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100)
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-bold text-on-surface-variant w-24 shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-surface-container-high rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold text-primary w-12 text-right">{value}/{max}</span>
    </div>
  )
}

function RawInputSection({ data, label }: { data: any; label: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!data || Object.keys(data).length === 0) return null

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[11px] text-on-surface-variant/60 hover:text-primary flex items-center gap-1"
      >
        <Icon name={expanded ? 'expand_less' : 'expand_more'} size="text-xs" />
        {label} raw inputs
      </button>
      {expanded && (
        <pre className="text-[10px] text-on-surface-variant bg-surface-container-low rounded p-2 mt-1 overflow-x-auto max-h-32">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

export function ScoreAuditModal({
  leadId,
  score,
  onClose,
}: {
  leadId: string
  score: HotScoreBreakdown
  onClose: () => void
}) {
  const [history, setHistory] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/hot-opportunities?audit=${leadId}`)
      .then(r => r.json())
      .then(data => {
        setHistory(data.history || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [leadId])

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-primary">Score Breakdown</h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-container-high">
              <Icon name="close" />
            </button>
          </div>

          {/* Current Score */}
          <div className="text-center mb-6">
            <div className="text-5xl font-black text-primary">{score.composite}</div>
            <div className={`text-sm font-bold mt-1 ${
              score.tierLabel === 'favorite' ? 'text-green-600' :
              score.tierLabel === 'caution' ? 'text-amber-600' : 'text-slate-500'
            }`}>
              {score.tierLabel.charAt(0).toUpperCase() + score.tierLabel.slice(1)}
              {score.tierCapped && ' (Capped)'}
            </div>
            {score.multiplier > 1 && (
              <div className="text-xs text-on-surface-variant mt-1">
                {score.multiplier}x multiplier applied
              </div>
            )}
          </div>

          {/* Score Bars */}
          <div className="space-y-4 mb-8">
            <ScoreBar label="Engagement" value={score.engagement} max={35} color="bg-blue-500" />
            <ScoreBar label="Velocity" value={score.velocity} max={25} color="bg-purple-500" />
            <ScoreBar label="Deal Quality" value={score.dealQuality} max={25} color="bg-green-500" />
            <ScoreBar label="Time Pressure" value={score.timePressure} max={15} color="bg-orange-500" />
          </div>

          {/* Score History */}
          <h3 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider mb-3">Score History</h3>
          {loading ? (
            <p className="text-sm text-slate-400">Loading audit trail...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-400">No audit history yet.</p>
          ) : (
            <div className="space-y-3">
              {history.slice(0, 20).map((entry, i) => (
                <div key={i} className="bg-surface-container-low rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-primary">{entry.composite_score}</span>
                    <span className="text-[10px] text-on-surface-variant">
                      {new Date(entry.created_at).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-on-surface-variant">
                    <span>{entry.tier_label}{entry.tier_capped ? ' (capped)' : ''}</span>
                    {entry.trigger_event && (
                      <span className="px-1.5 py-0.5 bg-surface-container-high rounded text-[9px]">
                        {entry.trigger_event}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-1 text-[10px] text-on-surface-variant/60">
                    <span>E:{entry.engagement_score}</span>
                    <span>V:{entry.velocity_score}</span>
                    <span>D:{entry.deal_quality_score}</span>
                    <span>T:{entry.time_pressure_score}</span>
                  </div>
                  <RawInputSection data={entry.raw_inputs} label="View" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
