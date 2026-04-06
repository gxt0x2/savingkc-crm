'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { EodData } from '@/hooks/use-ari-page'

interface EndOfDayBlockProps {
  eod: EodData | null
  activityCounts: { calls: number; sms_sent: number; sms_received: number; voicemails: number }
  followUpCompleted: number
  followUpTotal: number
  inboxCount: number
  pipelineHandled: number
  pipelineTotal: number
  loading: boolean
}

function StatBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : (value > 0 ? 100 : 0)
  return (
    <div className="text-center">
      <p className="text-2xl font-black text-slate-800 tabular-nums">{value}</p>
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1 mb-1">
        <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{label}</p>
    </div>
  )
}

export function EndOfDayBlock({
  eod, activityCounts, followUpCompleted, followUpTotal, inboxCount, pipelineHandled, pipelineTotal, loading,
}: EndOfDayBlockProps) {
  const [wentWell, setWentWell] = useState('')
  const [priority, setPriority] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmitEod() {
    setSubmitting(true)
    try {
      await fetch('/api/eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          went_right: wentWell,
          lesson_learned: priority,
          team_member: 'Rep',
          checklist_items: {
            dials: activityCounts.calls,
            sms_sent: activityCounts.sms_sent,
            tasks_completed: followUpCompleted,
            inbox_cleared: inboxCount === 0,
          },
        }),
      })
      setSubmitted(true)
    } catch {
      // silently fail
    } finally {
      setSubmitting(false)
    }
  }

  const wrapUp = eod?.wrapUp || ''

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-4 flex items-center gap-2">
        <Icon name="nightlight" className="text-primary text-lg" />
        <h2 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">End of Day</h2>
      </div>

      <div className="border-t border-slate-50 p-5">
        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <StatBar value={activityCounts.calls} max={50} label="Dials" />
          <StatBar value={activityCounts.sms_sent} max={20} label="SMS Sent" />
          <StatBar value={followUpCompleted} max={followUpTotal || 1} label="Tasks Done" />
          <StatBar value={pipelineHandled} max={pipelineTotal || 1} label="Pipeline" />
        </div>

        {/* Status line */}
        <div className="text-xs text-slate-400 mb-4 text-center">
          Tasks: {followUpCompleted}/{followUpTotal} done
          {' · '}Inbox: {inboxCount === 0 ? 'cleared' : `${inboxCount} remaining`}
          {' · '}Pipeline: {pipelineHandled}/{pipelineTotal} handled
        </div>

        {/* AI Wrap-up */}
        {wrapUp && (
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 mb-4 border border-amber-100">
            <div className="flex items-start gap-2">
              <span className="text-lg">🏆</span>
              <p className="text-sm text-slate-700 font-medium italic">&ldquo;{wrapUp}&rdquo;</p>
            </div>
          </div>
        )}

        {/* Reflection form */}
        {!submitted ? (
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quick Reflection (optional)</p>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">What went well today?</label>
              <input
                type="text"
                value={wentWell}
                onChange={(e) => setWentWell(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
                placeholder="e.g., Got a verbal yes from Johnson..."
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">#1 priority for tomorrow?</label>
              <input
                type="text"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
                placeholder="e.g., Send offer to Williams..."
              />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSubmitEod}
                disabled={submitting}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-bold transition-colors',
                  submitting ? 'bg-slate-200 text-slate-400' : 'bg-primary text-white hover:bg-primary/90'
                )}
              >
                {submitting ? 'Submitting...' : 'Submit EOD'}
              </button>
              <button
                onClick={() => window.location.href = '/checklist'}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Full EOD Protocol →
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <Icon name="check_circle" className="text-emerald-500 text-3xl mb-2" />
            <p className="text-sm font-bold text-emerald-700">EOD submitted — great work today!</p>
          </div>
        )}
      </div>
    </div>
  )
}
