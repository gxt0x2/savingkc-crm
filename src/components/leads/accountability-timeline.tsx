'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { TimelineEvent } from '@/lib/agent-scorecard'

interface Props {
  leadId: string
}

export function AccountabilityTimeline({ leadId }: Props) {
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTimeline()
  }, [leadId])

  async function fetchTimeline() {
    try {
      const res = await fetch(`/api/agent/accountability-timeline?lead_id=${leadId}`)
      if (res.ok) {
        const data = await res.json()
        setTimeline(data.timeline || [])
      }
    } catch (err) {
      console.error('Failed to fetch accountability timeline:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-200 rounded w-1/4" />
          <div className="h-16 bg-slate-200 rounded" />
        </div>
      </div>
    )
  }

  if (timeline.length === 0) {
    return null
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
        <Icon name="timeline" size="text-base" />
        Accountability Timeline
      </h2>

      <div className="space-y-3">
        {timeline.map((event, idx) => (
          <div key={idx} className="flex items-start gap-3 pb-3 border-b border-outline-variant/10 last:border-0 last:pb-0">
            {/* Status Icon */}
            <div className="shrink-0 mt-0.5">
              {event.status === 'completed_on_time' && (
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                  <Icon name="check" size="text-sm" className="text-green-700" />
                </div>
              )}
              {event.status === 'completed_late' && (
                <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
                  <Icon name="schedule" size="text-sm" className="text-amber-700" />
                </div>
              )}
              {event.status === 'missed' && (
                <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
                  <Icon name="close" size="text-sm" className="text-red-700" />
                </div>
              )}
            </div>

            {/* Event Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-on-surface-variant">
                  {new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                {event.status === 'completed_late' && event.days_late && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">
                    +{event.days_late}d
                  </span>
                )}
              </div>
              <div className="text-sm">
                <div className="font-semibold text-primary">Expected: {event.expected_action}</div>
                {event.actual_action && (
                  <div className="text-xs text-on-surface-variant mt-0.5">
                    Actual: {event.actual_action}
                  </div>
                )}
                {!event.actual_action && event.status === 'missed' && (
                  <div className="text-xs text-red-600 font-semibold mt-0.5">Missed</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="mt-5 pt-5 border-t border-outline-variant/10 grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-xl font-black text-green-600">
            {timeline.filter((e) => e.status === 'completed_on_time').length}
          </div>
          <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">On Time</div>
        </div>
        <div>
          <div className="text-xl font-black text-amber-600">
            {timeline.filter((e) => e.status === 'completed_late').length}
          </div>
          <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">Late</div>
        </div>
        <div>
          <div className="text-xl font-black text-red-600">
            {timeline.filter((e) => e.status === 'missed').length}
          </div>
          <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">Missed</div>
        </div>
      </div>
    </div>
  )
}
