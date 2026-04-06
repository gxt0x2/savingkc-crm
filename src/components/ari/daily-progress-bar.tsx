'use client'

import { cn } from '@/lib/utils'

interface DailyProgressBarProps {
  callsDone: number
  callsTarget: number
  tasksDone: number
  tasksTotal: number
  inboxCleared: number
  inboxTotal: number
  pipelineHandled: number
  pipelineTotal: number
}

export function DailyProgressBar({
  callsDone, callsTarget, tasksDone, tasksTotal, inboxCleared, inboxTotal, pipelineHandled, pipelineTotal,
}: DailyProgressBarProps) {
  // Calculate aggregate progress
  const segments = [
    { done: Math.min(callsDone, callsTarget), total: callsTarget },
    { done: tasksDone, total: Math.max(tasksTotal, 1) },
    { done: inboxCleared, total: Math.max(inboxTotal, 1) },
    { done: pipelineHandled, total: Math.max(pipelineTotal, 1) },
  ]
  const totalDone = segments.reduce((s, seg) => s + seg.done, 0)
  const totalAll = segments.reduce((s, seg) => s + seg.total, 0)
  const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0
  const isComplete = pct >= 100

  return (
    <div className="sticky top-16 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-4 sm:px-6 lg:px-8 py-2">
      <div className="max-w-[1440px] mx-auto flex items-center gap-4">
        <span className={cn(
          'text-xs font-black uppercase tracking-[0.15em] whitespace-nowrap',
          isComplete ? 'text-emerald-600' : 'text-slate-500'
        )}>
          {isComplete ? 'Mission Complete' : "Today's Mission"}
        </span>

        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-1000',
              isComplete ? 'bg-emerald-500' : 'bg-primary'
            )}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>

        <span className={cn(
          'text-xs font-bold tabular-nums whitespace-nowrap',
          isComplete ? 'text-emerald-600' : 'text-slate-600'
        )}>
          {pct}%
        </span>

        <div className="hidden sm:flex items-center gap-3 text-[10px] text-slate-400 font-medium">
          <span>Calls <span className="text-slate-600 font-bold">{callsDone}/{callsTarget}</span></span>
          <span className="text-slate-200">·</span>
          <span>Tasks <span className="text-slate-600 font-bold">{tasksDone}/{tasksTotal}</span></span>
          <span className="text-slate-200">·</span>
          <span>Inbox <span className="text-slate-600 font-bold">{inboxCleared}/{inboxTotal}</span></span>
          <span className="text-slate-200">·</span>
          <span>Pipeline <span className="text-slate-600 font-bold">{pipelineHandled}/{pipelineTotal}</span></span>
        </div>
      </div>
    </div>
  )
}
