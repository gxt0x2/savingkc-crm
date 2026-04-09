'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { formatPhone } from '@/lib/format'
import { QuickReplyInput } from './quick-reply-input'
import type { InboxItem } from '@/hooks/use-ari-page'

interface InboxBlockProps {
  items: InboxItem[]
  count: number
  loading: boolean
  onRefresh: () => void
}

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function InboxBlock({ items, count, loading, onRefresh }: InboxBlockProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null)

  function openDialer(phone: string, name: string, leadId: string) {
    window.dispatchEvent(new CustomEvent('open-dialer', {
      detail: { phone, name, leadId }
    }))
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-5 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="inbox" className="text-primary text-lg" />
          <h2 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Inbox</h2>
        </div>
        {count > 0 && (
          <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
            {count} need{count !== 1 ? '' : 's'} repl{count !== 1 ? 'ies' : 'y'}
          </span>
        )}
      </div>

      <div className="border-t border-slate-50">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading inbox...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="mark_email_read" className="text-emerald-400 text-3xl mb-2" />
            <p className="text-sm text-slate-500">Inbox clear — all caught up!</p>
          </div>
        ) : (
          items.map((item, i) => (
            <div
              key={item.id}
              className={cn('border-b border-slate-50 last:border-0')}
            >
              <div className="flex items-start gap-3 px-5 py-3">
                {/* Icon */}
                <div className="flex-shrink-0 mt-0.5">
                  {item.type === 'sms' ? (
                    <Icon name="chat_bubble" className="text-blue-500 text-lg" />
                  ) : (
                    <Icon name="phone_missed" className="text-red-500 text-lg" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {item.type === 'missed_call' && (
                      <span className="text-xs font-bold text-red-500">Missed Call —</span>
                    )}
                    <span className="text-sm font-bold text-slate-800">{item.lead_name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">{formatPhone(item.phone)}</span>
                  </div>
                  {item.message && (
                    <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">&ldquo;{item.message}&rdquo;</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-400">{formatTimeAgo(item.created_at)}</span>
                    {item.station && (
                      <>
                        <span className="text-slate-200">·</span>
                        <span className="text-xs text-slate-400">Station: {item.station.replace(/_/g, ' ')}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {item.type === 'sms' && (
                    <button
                      onClick={() => setReplyingTo(replyingTo === item.id ? null : item.id)}
                      className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      REPLY
                    </button>
                  )}
                  <button
                    onClick={() => openDialer(item.phone || '', item.lead_name, item.lead_id)}
                    className="px-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600 transition-colors"
                  >
                    {item.type === 'missed_call' ? 'CALL BACK' : 'CALL'}
                  </button>
                  <button
                    onClick={() => window.location.href = `/leads/${item.lead_id}`}
                    className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                    title="View lead"
                  >
                    <Icon name="open_in_new" className="text-base" />
                  </button>
                </div>
              </div>

              {/* Quick Reply */}
              {replyingTo === item.id && item.phone && (
                <QuickReplyInput
                  leadId={item.lead_id}
                  phone={item.phone}
                  onSent={() => { setReplyingTo(null); onRefresh() }}
                  onCancel={() => setReplyingTo(null)}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
