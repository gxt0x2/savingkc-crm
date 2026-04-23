'use client'

import { useEffect, useState } from 'react'

interface Stats {
  summary: {
    views: number
    unique_visitors: number
    shares: number
    share_visits: number
    photo_opens: number
    street_view_opens: number
    map_view_opens: number
    offer_modal_opens: number
    offers_submitted: number
    inquiry_modal_opens: number
    inquiries_submitted: number
    conversion_rate_pct: number
  }
  top_referrers: { host: string; count: number }[]
  views_by_day: { day: string; count: number }[]
  offers: { id: string; offer_amount: number; status: string; created_at: string }[]
}

function StatCell({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex-1 min-w-[80px]">
      <p className="text-[10px] uppercase tracking-wider text-[var(--ck-text-muted)] font-semibold leading-none">{label}</p>
      <p className="text-xl font-black text-[var(--ck-text)] mt-1">{value}</p>
      {sub && <p className="text-[11px] text-[var(--ck-text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

export function DealStatsPanel({ slug }: { slug: string }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch(`/api/deals/${slug}/stats`)
      .then(r => r.json())
      .then(d => { if (alive && !d.error) setStats(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [slug])

  if (loading) {
    return <div className="ck-card p-4 text-xs text-[var(--ck-text-muted)]">Loading stats…</div>
  }

  if (!stats) {
    return <div className="ck-card p-4 text-xs text-[var(--ck-text-muted)]">No stats available</div>
  }

  const { summary, top_referrers, offers } = stats
  const viewsToOfferRate = summary.views > 0
    ? Math.round((summary.offers_submitted / summary.views) * 100 * 10) / 10
    : 0

  return (
    <div className="ck-card overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--ck-border)] flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--ck-text)]">Deal Page Analytics</h3>
        <span className="text-[10px] uppercase tracking-wider text-[var(--ck-text-dim)]">Live</span>
      </div>

      {/* Top-line stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-4 py-4 border-b border-[var(--ck-border)]">
        <StatCell label="Views" value={summary.views} sub={`${summary.unique_visitors} unique`} />
        <StatCell label="Shares" value={summary.shares} sub={`${summary.share_visits} visits`} />
        <StatCell label="Offers" value={summary.offers_submitted} sub={`${viewsToOfferRate}% conv`} />
        <StatCell label="Inquiries" value={summary.inquiries_submitted} sub={`${summary.inquiry_modal_opens} opens`} />
      </div>

      {/* Engagement funnel */}
      <div className="px-4 py-4 border-b border-[var(--ck-border)]">
        <p className="text-[10px] uppercase tracking-wider text-[var(--ck-text-muted)] font-semibold mb-3">Engagement</p>
        <div className="space-y-2">
          {[
            { label: 'Photo Views', value: summary.photo_opens },
            { label: 'Street View', value: summary.street_view_opens },
            { label: 'Map View', value: summary.map_view_opens },
            { label: 'Offer Modal', value: summary.offer_modal_opens },
          ].map(row => {
            const max = Math.max(summary.photo_opens, summary.street_view_opens, summary.map_view_opens, summary.offer_modal_opens, 1)
            const pct = (row.value / max) * 100
            return (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-[12px] text-[var(--ck-text-muted)] w-24 flex-shrink-0">{row.label}</span>
                <div className="flex-1 h-1.5 bg-[var(--ck-surface-elev)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#E32E2E] rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[12px] font-semibold text-[var(--ck-text)] w-8 text-right">{row.value}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Top referrers */}
      {top_referrers.length > 0 && (
        <div className="px-4 py-4 border-b border-[var(--ck-border)]">
          <p className="text-[10px] uppercase tracking-wider text-[var(--ck-text-muted)] font-semibold mb-2">Top Referrers</p>
          <div className="space-y-1">
            {top_referrers.slice(0, 5).map(r => (
              <div key={r.host} className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--ck-text-muted)] truncate">{r.host}</span>
                <span className="font-semibold text-[var(--ck-text)]">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent offers */}
      {offers.length > 0 && (
        <div className="px-4 py-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--ck-text-muted)] font-semibold mb-2">Recent Offers</p>
          <div className="space-y-2">
            {offers.slice(0, 5).map(o => (
              <div key={o.id} className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--ck-text)] font-semibold">
                  ${o.offer_amount.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold ${
                    o.status === 'accepted' ? 'bg-emerald-500/10 text-emerald-400' :
                    o.status === 'rejected' ? 'bg-red-500/10 text-red-400' :
                    'bg-amber-500/10 text-amber-400'
                  }`}>
                    {o.status}
                  </span>
                  <span className="text-[var(--ck-text-dim)]">
                    {new Date(o.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
