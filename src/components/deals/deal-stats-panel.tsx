'use client'

import { useEffect, useState } from 'react'

interface Stats {
  summary: {
    views: number
    unique_visitors: number
    sessions: number
    bounce_rate: number
    conversion_rate_pct: number
    shares: number
    share_visits: number
    save_taps: number
    saves: number
    unsaves: number
    photo_opens: number
    street_view_opens: number
    map_view_opens: number
    offer_modal_opens: number
    offers_submitted: number
    inquiry_modal_opens: number
    inquiries_submitted: number
    avg_time_on_page_ms: number
    median_time_on_page_ms: number
    p75_time_on_page_ms: number
    avg_active_time_ms: number
    total_time_on_site_ms: number
    avg_scroll_pct: number
  }
  scroll_distribution: { range: string; count: number }[]
  devices: { name: string; count: number }[]
  browsers: { name: string; count: number }[]
  oses: { name: string; count: number }[]
  countries: { name: string; count: number }[]
  cities: { name: string; count: number }[]
  top_referrers: { host: string; count: number }[]
  utm_sources: { name: string; count: number }[]
  heat_map: { x: number; y: number; count: number }[]
  section_engagement: { name: string; count: number }[]
  views_by_day: { day: string; count: number }[]
  funnel: Record<string, number>
  offers: { id: string; offer_amount: number; status: string; created_at: string }[]
  top_sessions: {
    session_id: string
    visitor_id: string | null
    device_type: string | null
    country: string | null
    city: string | null
    referrer: string | null
    total_duration_ms: number | null
    active_duration_ms: number | null
    max_scroll_pct: number | null
    interactions: number | null
    sections_viewed: string[] | null
    converted: boolean | null
    attention_score: number
    started_at: string
  }[]
  recent_events: {
    event_type: string
    created_at: string
    element_text: string | null
    section: string | null
    scroll_pct: number | null
  }[]
}

function fmtDuration(ms: number): string {
  if (ms === 0) return '0s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m ${rs}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function Stat({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${accent ? 'bg-[#E32E2E]/5 border border-[#E32E2E]/20' : 'bg-slate-50'}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 leading-none">{label}</p>
      <p className={`text-xl font-black mt-1 ${accent ? 'text-[#E32E2E]' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function Bar({ label, value, max, color = '#E32E2E' }: { label: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-slate-600 w-28 flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[12px] font-semibold text-slate-900 w-10 text-right">{value}</span>
    </div>
  )
}

function HeatMap({ points }: { points: { x: number; y: number; count: number }[] }) {
  if (points.length === 0) {
    return <p className="text-xs text-slate-400 text-center py-6">No click data yet</p>
  }
  const maxCount = Math.max(...points.map(p => p.count), 1)
  return (
    <div className="relative bg-slate-50 border border-slate-200 rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
      {points.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: '20px',
            height: '20px',
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, rgba(227,46,46,${Math.min(0.8, 0.2 + (p.count / maxCount) * 0.6)}) 0%, transparent 70%)`,
            opacity: 0.7,
          }}
          title={`${p.count} click${p.count !== 1 ? 's' : ''}`}
        />
      ))}
      <div className="absolute top-2 left-2 text-[10px] font-semibold text-slate-500 bg-white/80 px-2 py-0.5 rounded">
        Click Heatmap
      </div>
    </div>
  )
}

export function DealStatsPanel({ slug }: { slug: string }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'audience' | 'engagement' | 'sessions' | 'heatmap'>('overview')

  useEffect(() => {
    let alive = true
    fetch(`/api/deals/${slug}/stats`)
      .then(r => r.json())
      .then(d => { if (alive && !d.error) setStats(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [slug])

  if (loading) return <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-500">Loading analytics…</div>
  if (!stats) return <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-500">No stats available</div>

  const s = stats.summary
  const maxInteractions = Math.max(
    s.photo_opens,
    s.street_view_opens,
    s.map_view_opens,
    s.offer_modal_opens,
    s.inquiry_modal_opens,
    s.save_taps,
    1
  )

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'audience', label: 'Audience' },
    { id: 'engagement', label: 'Engagement' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'heatmap', label: 'Heat Map' },
  ] as const

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header + tabs */}
      <div className="border-b border-slate-200">
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="text-sm font-bold text-slate-900">Deal Page Analytics</h3>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Live</span>
        </div>
        <div className="flex px-2 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                tab === t.id ? 'border-[#E32E2E] text-[#E32E2E]' : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Views" value={s.views} sub={`${s.unique_visitors} unique`} />
            <Stat label="Sessions" value={s.sessions} sub={`${s.bounce_rate}% bounce`} />
            <Stat label="Avg Time" value={fmtDuration(s.avg_time_on_page_ms)} sub={`median ${fmtDuration(s.median_time_on_page_ms)}`} />
            <Stat label="Offers" value={s.offers_submitted} sub={`${s.conversion_rate_pct}% conv`} accent />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Stat label="Active Time" value={fmtDuration(s.avg_active_time_ms)} sub="engaged only" />
            <Stat label="Total Time" value={fmtDuration(s.total_time_on_site_ms)} sub="all visitors" />
            <Stat label="Avg Scroll" value={`${s.avg_scroll_pct}%`} sub="of page" />
            <Stat label="Shares" value={s.shares} sub={`${s.share_visits} visits`} />
            <Stat label="Likes" value={s.saves} sub={`${s.save_taps} taps`} />
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Conversion Funnel</p>
            <div className="space-y-1.5">
              {[
                { label: 'Visitors', value: stats.funnel.visitors },
                { label: 'Sessions', value: stats.funnel.sessions },
                { label: 'Engaged', value: stats.funnel.engaged_sessions },
                { label: 'Viewed Photos', value: stats.funnel.photos_opened },
                { label: 'Opened Offer', value: stats.funnel.offer_modal_opened },
                { label: 'Submitted Offer', value: stats.funnel.offers_submitted },
              ].map((f, i, arr) => (
                <Bar key={f.label} label={f.label} value={f.value} max={arr[0].value} color={i === arr.length - 1 ? '#10b981' : '#E32E2E'} />
              ))}
            </div>
          </div>

          {stats.offers.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Recent Offers</p>
              <div className="space-y-1">
                {stats.offers.slice(0, 5).map(o => (
                  <div key={o.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-3 py-2">
                    <span className="font-bold text-slate-900">${o.offer_amount.toLocaleString()}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${
                        o.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                        o.status === 'rejected' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{o.status}</span>
                      <span className="text-slate-400">{new Date(o.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Audience tab */}
      {tab === 'audience' && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Devices</p>
              {stats.devices.length === 0 ? <p className="text-xs text-slate-400">No data yet</p> : (
                <div className="space-y-1.5">
                  {stats.devices.map(d => <Bar key={d.name} label={d.name} value={d.count} max={stats.devices[0].count} />)}
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Browsers</p>
              {stats.browsers.length === 0 ? <p className="text-xs text-slate-400">No data yet</p> : (
                <div className="space-y-1.5">
                  {stats.browsers.slice(0, 5).map(b => <Bar key={b.name} label={b.name} value={b.count} max={stats.browsers[0].count} color="#3b82f6" />)}
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Operating Systems</p>
              {stats.oses.length === 0 ? <p className="text-xs text-slate-400">No data yet</p> : (
                <div className="space-y-1.5">
                  {stats.oses.slice(0, 5).map(o => <Bar key={o.name} label={o.name} value={o.count} max={stats.oses[0].count} color="#8b5cf6" />)}
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Top Locations</p>
              {stats.cities.length === 0 ? <p className="text-xs text-slate-400">No location data yet</p> : (
                <div className="space-y-1.5">
                  {stats.cities.slice(0, 5).map(c => <Bar key={c.name} label={c.name} value={c.count} max={stats.cities[0].count} color="#f59e0b" />)}
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Top Referrers</p>
            {stats.top_referrers.length === 0 ? (
              <p className="text-xs text-slate-400">Direct traffic only so far</p>
            ) : (
              <div className="space-y-1">
                {stats.top_referrers.map(r => (
                  <div key={r.host} className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-600 truncate">{r.host}</span>
                    <span className="font-semibold text-slate-900">{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {stats.utm_sources.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">UTM Sources</p>
              <div className="space-y-1">
                {stats.utm_sources.map(u => (
                  <div key={u.name} className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-600">{u.name}</span>
                    <span className="font-semibold text-slate-900">{u.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Engagement tab */}
      {tab === 'engagement' && (
        <div className="p-4 space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Scroll Depth Distribution</p>
            <div className="space-y-1.5">
              {stats.scroll_distribution.map((b, i) => {
                const max = Math.max(...stats.scroll_distribution.map(x => x.count), 1)
                return <Bar key={b.range} label={b.range} value={b.count} max={max} color={['#ef4444', '#f59e0b', '#3b82f6', '#10b981'][i]} />
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Section Engagement</p>
            {stats.section_engagement.length === 0 ? (
              <p className="text-xs text-slate-400">No section data yet (need 1+ second dwell)</p>
            ) : (
              <div className="space-y-1.5">
                {stats.section_engagement.map(se => (
                  <Bar key={se.name} label={se.name} value={se.count} max={stats.section_engagement[0].count} color="#8b5cf6" />
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Interaction Breakdown</p>
            <div className="space-y-1.5">
              <Bar label="Photo Opens" value={s.photo_opens} max={maxInteractions} />
              <Bar label="Street View" value={s.street_view_opens} max={maxInteractions} />
              <Bar label="Map View" value={s.map_view_opens} max={maxInteractions} />
              <Bar label="Offer Modal" value={s.offer_modal_opens} max={maxInteractions} />
              <Bar label="Inquiry Modal" value={s.inquiry_modal_opens} max={maxInteractions} />
              <Bar label="Like Taps" value={s.save_taps} max={maxInteractions} color="#e11d48" />
            </div>
          </div>
        </div>
      )}

      {/* Sessions tab — attention-score ranked */}
      {tab === 'sessions' && (
        <div className="p-4">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">
            Top Visitors by Attention Score ({stats.top_sessions.length})
          </p>
          {stats.top_sessions.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No sessions yet</p>
          ) : (
            <div className="space-y-2">
              {stats.top_sessions.slice(0, 15).map(sess => (
                <div key={sess.session_id} className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-black ${
                        sess.attention_score >= 70 ? 'bg-emerald-100 text-emerald-700' :
                        sess.attention_score >= 40 ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {sess.attention_score}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {sess.city || sess.country || 'Unknown'} · {sess.device_type || '?'}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {new Date(sess.started_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 ml-10">
                      <span>{fmtDuration(sess.active_duration_ms || 0)} active</span>
                      <span>·</span>
                      <span>{sess.max_scroll_pct}% scroll</span>
                      <span>·</span>
                      <span>{sess.interactions} clicks</span>
                      {sess.converted && <span className="text-emerald-600 font-bold">· Converted</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Heatmap tab */}
      {tab === 'heatmap' && (
        <div className="p-4 space-y-3">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
            Click Heat Map ({stats.heat_map.length} zones)
          </p>
          <HeatMap points={stats.heat_map} />
          <p className="text-[11px] text-slate-500">
            Red dots show where visitors clicked on the page. Brighter = more clicks. Positions are relative to the viewport.
          </p>
        </div>
      )}
    </div>
  )
}
