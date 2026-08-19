// MNT-03: Mail History + Batch View
// Night 4 Phase 2: Batch view for all mail pieces across all leads

'use client'

import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

type MailStatus = 'queued' | 'written' | 'mailed' | 'in_transit' | 'delivered' | 'follow_up_scheduled' | 'follow_up_completed' | 'returned'

interface MailPieceWithLead {
  id: string
  lead_id: string
  type: string
  status: MailStatus
  created_at: string
  mailed_date: string | null
  estimated_delivery_date: string | null
  follow_up_date: string | null
  follow_up_completed_date: string | null
  tracking_number: string | null
  notes: string | null
  lead_name: string | null
  lead_address: string | null
}

type MailPieceQueryRow = Omit<MailPieceWithLead, 'lead_name' | 'lead_address'> & {
  leads?: { full_name?: string | null; property_address?: string | null } | null
}

interface MailBatchViewProps {
  filterStatus?: MailStatus | 'all'
}

export function MailBatchView({ filterStatus = 'all' }: MailBatchViewProps) {
  const [mailPieces, setMailPieces] = useState<MailPieceWithLead[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<MailStatus | 'all'>(filterStatus)

  useEffect(() => {
    let cancelled = false

    async function fetchAllMail() {
      const supabase = createClient()

      let query = supabase
        .from('mail_pieces')
        .select(`
          *,
          leads!inner(full_name, property_address)
        `)
        .order('created_at', { ascending: false })

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data } = await query

      const pieces = ((data ?? []) as MailPieceQueryRow[]).map((item) => ({
        ...item,
        lead_name: item.leads?.full_name ?? null,
        lead_address: item.leads?.property_address ?? null,
      }))

      if (!cancelled) {
        setMailPieces(pieces)
        setLoading(false)
      }
    }

    void fetchAllMail()
    return () => { cancelled = true }
  }, [statusFilter])

  const statusCounts = {
    all: mailPieces.length,
    queued: mailPieces.filter(p => p.status === 'queued').length,
    written: mailPieces.filter(p => p.status === 'written').length,
    mailed: mailPieces.filter(p => p.status === 'mailed').length,
    in_transit: mailPieces.filter(p => p.status === 'in_transit').length,
    delivered: mailPieces.filter(p => p.status === 'delivered').length,
    follow_up_scheduled: mailPieces.filter(p => p.status === 'follow_up_scheduled').length,
    needs_follow_up: mailPieces.filter(p => p.status === 'follow_up_scheduled' && !p.follow_up_completed_date).length,
  }

  function formatDate(date: string | null): string {
    if (!date) return '—'
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const statusConfig: Record<MailStatus | 'all', { label: string; color: string; icon: string }> = {
    all: { label: 'All Mail', color: 'bg-slate-100 text-slate-700', icon: 'mail' },
    queued: { label: 'Queued', color: 'bg-blue-100 text-blue-700', icon: 'inbox' },
    written: { label: 'Written', color: 'bg-purple-100 text-purple-700', icon: 'edit' },
    mailed: { label: 'Mailed', color: 'bg-green-100 text-green-700', icon: 'send' },
    in_transit: { label: 'In Transit', color: 'bg-amber-100 text-amber-700', icon: 'local_shipping' },
    delivered: { label: 'Delivered', color: 'bg-emerald-100 text-emerald-700', icon: 'check_circle' },
    follow_up_scheduled: { label: 'Needs Follow-Up', color: 'bg-red-100 text-red-700', icon: 'phone' },
    follow_up_completed: { label: 'Follow-Up Done', color: 'bg-gray-100 text-gray-600', icon: 'done_all' },
    returned: { label: 'Returned', color: 'bg-orange-100 text-orange-700', icon: 'keyboard_return' },
  }

  if (loading) {
    return <div className="text-center py-8 text-on-surface-variant">Loading mail...</div>
  }

  return (
    <div>
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        <StatCard
          label="Total"
          count={statusCounts.all}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <StatCard
          label="Queued"
          count={statusCounts.queued}
          active={statusFilter === 'queued'}
          onClick={() => setStatusFilter('queued')}
        />
        <StatCard
          label="Written"
          count={statusCounts.written}
          active={statusFilter === 'written'}
          onClick={() => setStatusFilter('written')}
        />
        <StatCard
          label="Mailed"
          count={statusCounts.mailed}
          active={statusFilter === 'mailed'}
          onClick={() => setStatusFilter('mailed')}
        />
        <StatCard
          label="In Transit"
          count={statusCounts.in_transit}
          active={statusFilter === 'in_transit'}
          onClick={() => setStatusFilter('in_transit')}
        />
        <StatCard
          label="Needs Follow-Up"
          count={statusCounts.needs_follow_up}
          active={statusFilter === 'follow_up_scheduled'}
          onClick={() => setStatusFilter('follow_up_scheduled')}
          pulse={statusCounts.needs_follow_up > 0}
        />
      </div>

      {/* Mail List */}
      {mailPieces.length === 0 ? (
        <div className="text-center py-12 bg-surface-container-low rounded-xl">
          <Icon name="mail" className="!text-5xl text-on-surface-variant/30 mb-4" />
          <p className="text-lg font-bold text-on-surface-variant/70">No mail pieces found</p>
          <p className="text-sm text-on-surface-variant/50 mt-1">
            {statusFilter !== 'all' ? `No mail pieces with status "${statusFilter}"` : 'Start tracking mail from lead pages'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {mailPieces.map((piece) => {
            const config = statusConfig[piece.status]
            return (
              <div
                key={piece.id}
                className="bg-surface-container-lowest border border-outline-variant/10 rounded-xl p-4 hover:border-primary/30 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Lead Info */}
                  <div className="flex-1">
                    <Link
                      href={`/leads/${piece.lead_id}`}
                      prefetch={false}
                      className="text-base font-bold text-primary hover:text-secondary transition-colors mb-1 block"
                    >
                      {piece.lead_name || 'Unknown Lead'}
                    </Link>
                    <p className="text-xs text-on-surface-variant mb-2">
                      {piece.lead_address || 'No address'}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${config.color}`}>
                        <Icon name={config.icon} className="!text-xs inline mr-1" />
                        {config.label}
                      </span>
                      <span className="text-[10px] text-on-surface-variant">
                        {piece.type.replace('_', ' ')}
                      </span>
                      {piece.tracking_number && (
                        <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                          {piece.tracking_number}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="text-right">
                    {piece.mailed_date && (
                      <p className="text-xs text-on-surface-variant mb-1">
                        Mailed: {formatDate(piece.mailed_date)}
                      </p>
                    )}
                    {piece.estimated_delivery_date && (
                      <p className="text-xs text-on-surface-variant mb-1">
                        Est. Delivery: {formatDate(piece.estimated_delivery_date)}
                      </p>
                    )}
                    {piece.follow_up_date && !piece.follow_up_completed_date && (
                      <p className="text-xs font-bold text-red-600">
                        Follow-up: {formatDate(piece.follow_up_date)}
                      </p>
                    )}
                    <p className="text-[10px] text-on-surface-variant/60 mt-1">
                      Created {formatDate(piece.created_at)}
                    </p>
                  </div>
                </div>

                {/* Notes */}
                {piece.notes && (
                  <p className="mt-3 text-xs text-on-surface-variant bg-surface-container px-3 py-2 rounded-lg">
                    {piece.notes}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  count,
  active,
  onClick,
  pulse = false,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  pulse?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-xl transition-all ${
        active
          ? 'bg-surface-container-high border-2 border-primary shadow-sm'
          : 'bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/30'
      } ${pulse ? 'animate-pulse' : ''}`}
    >
      <p className="text-xs font-bold uppercase text-on-surface-variant mb-1">{label}</p>
      <p className={`text-2xl font-black ${active ? 'text-primary' : 'text-on-surface'}`}>
        {count}
      </p>
    </button>
  )
}
