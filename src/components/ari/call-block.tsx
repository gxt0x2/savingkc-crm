'use client'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { CallQueueLead } from '@/hooks/use-ari-page'

interface CallBlockProps {
  queue: CallQueueLead[]
  counts: { dials: number; contacts: number; appointments: number }
  targets: { dials: number; contacts: number; appointments: number }
  loading: boolean
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={cn('h-full rounded-full transition-all duration-1000', color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function openDialer(lead: CallQueueLead) {
  window.dispatchEvent(new CustomEvent('open-dialer', {
    detail: { phone: lead.phone, name: lead.full_name, leadId: lead.id }
  }))
}

export function CallBlock({ queue, counts, targets, loading }: CallBlockProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="call" className="text-primary text-lg" />
          <h2 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Call Block</h2>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">{counts.dials}/{targets.dials}</span>
            <span>dials</span>
            <MiniBar value={counts.dials} max={targets.dials} color="bg-primary" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">{counts.contacts}/{targets.contacts}</span>
            <span>contacts</span>
            <MiniBar value={counts.contacts} max={targets.contacts} color="bg-emerald-500" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">{counts.appointments}</span>
            <span>appt</span>
            <MiniBar value={counts.appointments} max={targets.appointments} color="bg-amber-500" />
          </div>
        </div>
      </div>

      {/* List */}
      <div className="border-t border-slate-50">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading call queue...</div>
        ) : queue.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="check_circle" className="text-emerald-400 text-3xl mb-2" />
            <p className="text-sm text-slate-500">Call queue is clear — nice work!</p>
          </div>
        ) : (
          queue.map((lead, i) => (
            <div
              key={lead.id}
              className={cn(
                'flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors cursor-pointer group',
                i < queue.length - 1 && 'border-b border-slate-50'
              )}
              onClick={() => window.location.href = `/leads/${lead.id}`}
            >
              {/* Priority icon */}
              <div className="flex-shrink-0 w-6 text-center">
                {lead.priority === 'hot' || lead.score >= 700 ? (
                  <Icon name="local_fire_department" className="text-red-500 text-lg" />
                ) : lead.score >= 400 ? (
                  <Icon name="arrow_upward" className="text-amber-500 text-lg" />
                ) : (
                  <Icon name="radio_button_unchecked" className="text-slate-300 text-sm" />
                )}
              </div>

              {/* Lead info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800 truncate">{lead.full_name}</span>
                  <span className="text-xs text-slate-400 tabular-nums">{lead.phone}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                  {lead.property_address && (
                    <span className="truncate">{lead.property_address}{lead.city ? `, ${lead.city}` : ''}</span>
                  )}
                  <span className="text-slate-200">·</span>
                  <span className="text-slate-500 font-medium">{lead.reason}</span>
                  {lead.inbound_activity && (
                    <>
                      <span className="text-slate-200">·</span>
                      <span className="text-emerald-600 font-medium">{formatTimeAgo(lead.inbound_activity.created_at)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); openDialer(lead) }}
                  className="px-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600 transition-colors flex items-center gap-1"
                >
                  <Icon name="call" className="text-sm" /> CALL
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); window.location.href = `/leads/${lead.id}?tab=sms` }}
                  className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-1"
                >
                  <Icon name="sms" className="text-sm" /> SMS
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
