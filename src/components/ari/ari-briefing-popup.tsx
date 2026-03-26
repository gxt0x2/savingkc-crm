'use client'

import { Icon } from '@/components/ui/icon'

export function AriBriefingPopup({
  followUpCount,
  optimalWindow,
}: {
  followUpCount: number
  optimalWindow: string
}) {
  return (
    <div className="fixed bottom-24 right-8 z-40 w-80 bg-primary-container text-white rounded-2xl p-5 shadow-2xl">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2.5 h-2.5 bg-secondary rounded-full shadow-[0_0_8px_#006e2f]" />
        <span className="text-[10px] font-black uppercase tracking-widest text-white/70">Ari Daily Briefing</span>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Icon name="task_alt" className="text-secondary" size="text-lg" />
          <div>
            <span className="text-sm font-bold">{followUpCount} Follow-ups Due</span>
            <p className="text-[11px] text-white/60">Priority contacts need attention</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Icon name="schedule" className="text-secondary" size="text-lg" />
          <div>
            <span className="text-sm font-bold">Optimal Call Window</span>
            <p className="text-[11px] text-white/60">{optimalWindow}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
