'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { FollowUp } from '@/hooks/use-ari-page'

interface FollowUpBlockProps {
  followUps: FollowUp[]
  completed: number
  total: number
  loading: boolean
  onRefresh: () => void
}

function ProgressDots({ completed, total }: { completed: number; total: number }) {
  const dots = Array.from({ length: total }, (_, i) => i < completed)
  return (
    <div className="flex items-center gap-0.5">
      {dots.map((done, i) => (
        <span key={i} className={cn('text-sm', done ? 'text-emerald-500' : 'text-slate-200')}>
          {done ? '✓' : '○'}
        </span>
      ))}
    </div>
  )
}

export function FollowUpBlock({ followUps, completed, total, loading, onRefresh }: FollowUpBlockProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const overdue = followUps.filter(f => f.is_overdue)
  const today = followUps.filter(f => !f.is_overdue)

  async function handleAction(taskId: string, action: 'complete' | 'snooze') {
    setActionLoading(taskId)
    try {
      await fetch('/api/ari/follow-ups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action }),
      })
      onRefresh()
    } catch {
      // silently fail
    } finally {
      setActionLoading(null)
    }
  }

  function openDialer(phone: string, name: string, leadId: string) {
    window.dispatchEvent(new CustomEvent('open-dialer', {
      detail: { phone, name, leadId }
    }))
  }

  function renderTask(task: FollowUp) {
    const isActioning = actionLoading === task.id
    return (
      <div
        key={task.id}
        className={cn(
          'flex items-start gap-3 px-5 py-3 border-b border-slate-50 last:border-0',
          task.is_overdue && 'bg-red-50/50'
        )}
      >
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {task.is_overdue ? (
            <Icon name="warning" className="text-red-500 text-lg" />
          ) : (
            <Icon name="schedule" className="text-slate-400 text-lg" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 truncate">{task.title}</span>
            {task.lead_name && (
              <span className="text-xs text-slate-400">— {task.lead_name}</span>
            )}
          </div>
          {task.description && (
            <p className="text-xs text-slate-400 mt-0.5 truncate">{task.description}</p>
          )}
          <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
            <span className={cn(task.is_overdue ? 'text-red-500 font-semibold' : 'text-slate-500')}>
              {task.is_overdue
                ? `Due ${new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : 'Due Today'
              }
            </span>
            {task.lead_address && (
              <>
                <span className="text-slate-200">·</span>
                <span>{task.lead_address}</span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {task.lead_phone && (
            <button
              onClick={() => openDialer(task.lead_phone!, task.lead_name || '', task.lead_id || '')}
              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Call"
            >
              <Icon name="call" className="text-base" />
            </button>
          )}
          <button
            onClick={() => handleAction(task.id, 'complete')}
            disabled={isActioning}
            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
            title="Mark complete"
          >
            <Icon name="check_circle" className="text-base" />
          </button>
          <button
            onClick={() => handleAction(task.id, 'snooze')}
            disabled={isActioning}
            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
            title="Snooze to tomorrow"
          >
            <Icon name="snooze" className="text-base" />
          </button>
          {task.lead_id && (
            <button
              onClick={() => window.location.href = `/leads/${task.lead_id}`}
              className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
              title="View lead"
            >
              <Icon name="open_in_new" className="text-base" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="task_alt" className="text-primary text-lg" />
          <h2 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Follow-Ups</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 font-medium">{completed} of {total} done</span>
          <ProgressDots completed={completed} total={total} />
        </div>
      </div>

      <div className="border-t border-slate-50">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading follow-ups...</div>
        ) : followUps.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="celebration" className="text-emerald-400 text-3xl mb-2" />
            <p className="text-sm text-slate-500">All caught up — no follow-ups due!</p>
          </div>
        ) : (
          <>
            {overdue.length > 0 && (
              <>
                <div className="px-5 py-2 bg-red-50 border-b border-red-100">
                  <span className="text-[10px] font-black text-red-500 uppercase tracking-wider">Overdue</span>
                </div>
                {overdue.map(renderTask)}
              </>
            )}
            {today.length > 0 && (
              <>
                <div className="px-5 py-2 bg-slate-50 border-b border-slate-100">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Today</span>
                </div>
                {today.map(renderTask)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
