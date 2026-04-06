'use client'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { PipelineAction } from '@/hooks/use-ari-page'

interface PipelineActionsBlockProps {
  actions: PipelineAction[]
  handled: number
  total: number
  loading: boolean
}

const actionIcons: Record<string, string> = {
  send_offer: 'attach_money',
  confirm_appt: 'event_available',
  get_info: 'help',
  follow_up: 'update',
}

const actionColors: Record<string, string> = {
  send_offer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  confirm_appt: 'bg-purple-50 text-purple-700 border-purple-200',
  get_info: 'bg-amber-50 text-amber-700 border-amber-200',
  follow_up: 'bg-blue-50 text-blue-700 border-blue-200',
}

function openDialer(lead: PipelineAction) {
  window.dispatchEvent(new CustomEvent('open-dialer', {
    detail: { phone: lead.phone, name: lead.full_name, leadId: lead.id }
  }))
}

export function PipelineActionsBlock({ actions, handled, total, loading }: PipelineActionsBlockProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="view_kanban" className="text-primary text-lg" />
          <h2 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Pipeline Actions</h2>
        </div>
        {total > 0 && (
          <span className="text-xs text-slate-500 font-medium">{handled} of {total} handled</span>
        )}
      </div>

      <div className="border-t border-slate-50">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading pipeline...</div>
        ) : actions.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="thumb_up" className="text-emerald-400 text-3xl mb-2" />
            <p className="text-sm text-slate-500">Pipeline is moving — nothing stuck!</p>
          </div>
        ) : (
          actions.map((action, i) => (
            <div
              key={action.id}
              className={cn(
                'flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors',
                i < actions.length - 1 && 'border-b border-slate-50'
              )}
            >
              {/* Action badge */}
              <div className={cn(
                'flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border mt-0.5',
                actionColors[action.action_type] || 'bg-slate-50 text-slate-600 border-slate-200'
              )}>
                {action.action_label}
              </div>

              {/* Lead info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800 truncate">{action.full_name}</span>
                  {action.station && (
                    <span className="text-[10px] font-bold text-slate-400 uppercase">{action.station.replace(/_/g, ' ')}</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {action.property_address && <>{action.property_address}{action.city ? `, ${action.city}` : ''} · </>}
                  {action.action_detail}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {action.action_type === 'send_offer' ? (
                  <button
                    onClick={() => window.location.href = `/leads/${action.id}`}
                    className="px-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600 transition-colors"
                  >
                    MAKE OFFER
                  </button>
                ) : action.action_type === 'confirm_appt' ? (
                  <button
                    onClick={() => openDialer(action)}
                    className="px-3 py-1.5 bg-purple-500 text-white text-xs font-bold rounded-lg hover:bg-purple-600 transition-colors"
                  >
                    CONFIRM
                  </button>
                ) : (
                  <button
                    onClick={() => openDialer(action)}
                    className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    CALL
                  </button>
                )}
                <button
                  onClick={() => window.location.href = `/leads/${action.id}`}
                  className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                  title="View lead"
                >
                  <Icon name="open_in_new" className="text-base" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
