'use client'

import { Icon } from '@/components/ui/icon'
import type { CoachingData } from '@/hooks/use-ari-page'

interface CoachingBannerProps {
  coaching: CoachingData | null
  loading: boolean
}

export function CoachingBanner({ coaching, loading }: CoachingBannerProps) {
  if (loading || !coaching) {
    return (
      <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-2xl p-6 animate-pulse">
        <div className="h-5 bg-primary/10 rounded w-2/3 mb-3" />
        <div className="h-4 bg-primary/10 rounded w-1/2 mb-2" />
        <div className="h-4 bg-primary/10 rounded w-3/4" />
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-primary/5 via-white to-blue-50 rounded-2xl border border-primary/10 p-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon name="assistant" className="text-primary text-xl" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-slate-800 mb-2">{coaching.greeting}</p>

          <div className="space-y-1.5">
            {coaching.nudges.map((nudge, i) => (
              <div key={i} className="flex items-start gap-2">
                <Icon name={i === 0 ? 'priority_high' : 'arrow_right'} className="text-primary/70 text-sm mt-0.5 flex-shrink-0" />
                <p className="text-sm text-slate-600">{nudge}</p>
              </div>
            ))}
          </div>

          {coaching.momentum && (
            <div className="mt-3 flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-2">
              <Icon name="local_fire_department" className="text-emerald-600 text-sm" />
              <p className="text-sm font-semibold text-emerald-700">{coaching.momentum}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
