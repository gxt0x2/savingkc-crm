'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { LandingHeatmapItem, LandingHeatmapPage, LandingHeatmapReport, LandingHeatmapSection, LandingHeatmapVideo } from '@/lib/marketing/landing-page-heatmaps'

type HeatmapTab = 'sections' | 'faqs' | 'ctas' | 'showMe' | 'videos' | 'specificity'
type HeatmapPageFilter = 'all' | '/ppc' | '/ppc-tax' | 'deals'

const DAY_OPTIONS = [7, 30, 90] as const
const PAGE_OPTIONS: Array<{ value: HeatmapPageFilter; label: string }> = [
  { value: 'all', label: 'All Pages' },
  { value: '/ppc', label: 'PPC' },
  { value: '/ppc-tax', label: 'PPC Tax' },
  { value: 'deals', label: 'Deal Pages' },
]
const TABS: Array<{ value: HeatmapTab; label: string }> = [
  { value: 'sections', label: 'Sections' },
  { value: 'faqs', label: 'FAQs' },
  { value: 'ctas', label: 'CTAs' },
  { value: 'showMe', label: 'Show Me' },
  { value: 'videos', label: 'Videos' },
  { value: 'specificity', label: 'Specificity' },
]

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString()
}

function formatDate(value: string | null): string {
  if (!value) return '--'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '--'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function emptyMessage(tab: HeatmapTab): string {
  if (tab === 'videos') return 'No video events recorded for this view yet.'
  if (tab === 'faqs') return 'No FAQ opens recorded for this view yet.'
  if (tab === 'ctas') return 'No CTA or navigation clicks recorded for this view yet.'
  if (tab === 'showMe') return 'No show-me clicks recorded for this view yet.'
  if (tab === 'specificity') return 'No generic tracking gaps found in this view.'
  return 'No section events recorded for this view yet.'
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'green' | 'amber' | 'blue' }) {
  return (
    <div className={`heatmap-stat ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PageCard({ page }: { page: LandingHeatmapPage }) {
  const topEvents = page.topEventNames.slice(0, 4)
  return (
    <article className="page-card">
      <div>
        <span className="page-path">{page.pageKey}</span>
        <h2>{page.pageLabel}</h2>
      </div>
      <div className="page-metrics">
        <span>{formatNumber(page.events)} events</span>
        <span>{formatNumber(page.sessions)} sessions</span>
        <span>{formatNumber(page.leads)} leads</span>
        <span>{page.specificityRate}% specific</span>
      </div>
      <div className="event-chips">
        {topEvents.length ? topEvents.map((item) => (
          <span key={item.eventName}>{item.eventName} {item.count}</span>
        )) : <span>No events</span>}
      </div>
    </article>
  )
}

function HeatBar({ value }: { value: number }) {
  return (
    <div className="heat-bar" aria-label={`${value}% intensity`}>
      <span style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
    </div>
  )
}

function SectionRows({ sections }: { sections: LandingHeatmapSection[] }) {
  if (!sections.length) return <div className="heatmap-empty">{emptyMessage('sections')}</div>
  return (
    <div className="heatmap-table">
      {sections.map((section) => (
        <article className="heat-row section-row" key={section.key}>
          <div>
            <span className="muted">{section.pageLabel}</span>
            <h3>{section.label}</h3>
            <div className="event-chips small">
              {section.topEventNames.map((item) => <span key={item.eventName}>{item.eventName} {item.count}</span>)}
            </div>
          </div>
          <HeatBar value={section.intensity} />
          <MetricSet count={section.count} sessions={section.sessions} leads={section.leads} lastSeenAt={section.lastSeenAt} />
        </article>
      ))}
    </div>
  )
}

function ItemRows({ items, emptyTab }: { items: LandingHeatmapItem[]; emptyTab: HeatmapTab }) {
  if (!items.length) return <div className="heatmap-empty">{emptyMessage(emptyTab)}</div>
  return (
    <div className="heatmap-table">
      {items.map((item) => (
        <article className={`heat-row ${item.detailCompleteness}`} key={item.key}>
          <div>
            <span className="muted">{item.pageLabel} / {item.section}</span>
            <h3>{item.label}</h3>
            {item.detailCompleteness === 'generic' ? <p>Needs item-level payload detail.</p> : null}
          </div>
          <MetricSet count={item.count} sessions={item.sessions} leads={item.leads} lastSeenAt={item.lastSeenAt} />
        </article>
      ))}
    </div>
  )
}

function VideoRows({ videos }: { videos: LandingHeatmapVideo[] }) {
  if (!videos.length) return <div className="heatmap-empty">{emptyMessage('videos')}</div>
  return (
    <div className="heatmap-table">
      {videos.map((video) => (
        <article className={`heat-row video-row ${video.detailCompleteness}`} key={video.key}>
          <div>
            <span className="muted">{video.pageLabel} / {video.section}</span>
            <h3>{video.label}</h3>
            <div className="video-progress">
              <span className={video.maxPercent >= 25 ? 'hit' : ''}>25%</span>
              <span className={video.maxPercent >= 50 ? 'hit' : ''}>50%</span>
              <span className={video.maxPercent >= 75 ? 'hit' : ''}>75%</span>
              <span className={video.maxPercent >= 100 ? 'hit' : ''}>100%</span>
            </div>
          </div>
          <div className="video-metrics">
            <span>Starts <strong>{video.starts}</strong></span>
            <span>25% <strong>{video.progress25}</strong></span>
            <span>50% <strong>{video.progress50}</strong></span>
            <span>75% <strong>{video.progress75}</strong></span>
            <span>Done <strong>{video.completes}</strong></span>
          </div>
          <MetricSet count={video.count} sessions={video.sessions} leads={video.leads} lastSeenAt={video.lastSeenAt} />
        </article>
      ))}
    </div>
  )
}

function MetricSet({ count, sessions, leads, lastSeenAt }: { count: number; sessions: number; leads: number; lastSeenAt: string | null }) {
  return (
    <div className="metric-set">
      <span><strong>{formatNumber(count)}</strong> events</span>
      <span><strong>{formatNumber(sessions)}</strong> sessions</span>
      <span><strong>{formatNumber(leads)}</strong> leads</span>
      <span>{formatDate(lastSeenAt)}</span>
    </div>
  )
}

function flatten<T>(pages: LandingHeatmapPage[], pick: (page: LandingHeatmapPage) => T[]): T[] {
  return pages.flatMap(pick)
}

export function LandingPageHeatmapsPage() {
  const [days, setDays] = useState<number>(30)
  const [pageFilter, setPageFilter] = useState<HeatmapPageFilter>('all')
  const [tab, setTab] = useState<HeatmapTab>('sections')
  const [data, setData] = useState<LandingHeatmapReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function loadHeatmaps() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ days: String(days), page: pageFilter })
        const response = await fetch(`/api/marketing/landing-page-heatmaps?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Heatmap request failed (${response.status})`)
        setData(await response.json() as LandingHeatmapReport)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Could not load heatmaps')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadHeatmaps()
    return () => controller.abort()
  }, [days, pageFilter, refreshToken])

  const sections = useMemo(() => flatten(data?.pages ?? [], (page) => page.sections), [data])
  const faqs = useMemo(() => flatten(data?.pages ?? [], (page) => page.faqs), [data])
  const ctas = useMemo(() => flatten(data?.pages ?? [], (page) => page.ctas), [data])
  const showMe = useMemo(() => flatten(data?.pages ?? [], (page) => page.showMe), [data])
  const videos = useMemo(() => flatten(data?.pages ?? [], (page) => page.videos), [data])

  return (
    <>
      <style>{HEATMAP_STYLES}</style>
      <main className="landing-heatmaps" data-theme="dark">
        <div className="heatmap-wrap">
          <header className="heatmap-header">
            <div>
              <Link className="back-link" href="/marketing">Ads Command</Link>
              <h1>Landing Page Heatmaps</h1>
              <p>Event attention by page, section, CTA, FAQ, video, and specificity.</p>
            </div>
            <button className="refresh-button" type="button" onClick={() => setRefreshToken((current) => current + 1)} disabled={loading}>
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
          </header>

          <section className="heatmap-stats" aria-label="Landing page heatmap summary">
            <Stat label="Events" value={data ? formatNumber(data.summary.events) : '--'} />
            <Stat label="Sessions" value={data ? formatNumber(data.summary.sessions) : '--'} tone="blue" />
            <Stat label="Leads" value={data ? formatNumber(data.summary.leads) : '--'} tone="green" />
            <Stat label="Pages" value={data ? formatNumber(data.summary.pages) : '--'} />
            <Stat label="Specific" value={data ? `${data.summary.specificityRate}%` : '--'} tone={data && data.summary.specificityRate < 80 ? 'amber' : 'green'} />
          </section>

          <section className="heatmap-controls" aria-label="Heatmap filters">
            <div className="segmented">
              {DAY_OPTIONS.map((option) => (
                <button key={option} className={days === option ? 'active' : ''} type="button" onClick={() => setDays(option)}>
                  {option}d
                </button>
              ))}
            </div>
            <div className="segmented wide">
              {PAGE_OPTIONS.map((option) => (
                <button key={option.value} className={pageFilter === option.value ? 'active' : ''} type="button" onClick={() => setPageFilter(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          {error ? <div className="heatmap-error" role="alert">{error}</div> : null}

          <section className="page-grid" aria-label="Tracked landing pages">
            {loading && !data ? (
              <div className="heatmap-empty">Loading heatmaps.</div>
            ) : data?.pages.length ? (
              data.pages.map((page) => <PageCard key={page.pageKey} page={page} />)
            ) : (
              <div className="heatmap-empty">No landing page events match this view.</div>
            )}
          </section>

          <section className="heatmap-panel" aria-label="Heatmap detail">
            <div className="tab-row">
              {TABS.map((item) => (
                <button key={item.value} className={tab === item.value ? 'active' : ''} type="button" onClick={() => setTab(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>

            {tab === 'sections' ? <SectionRows sections={sections} /> : null}
            {tab === 'faqs' ? <ItemRows items={faqs} emptyTab="faqs" /> : null}
            {tab === 'ctas' ? <ItemRows items={ctas} emptyTab="ctas" /> : null}
            {tab === 'showMe' ? <ItemRows items={showMe} emptyTab="showMe" /> : null}
            {tab === 'videos' ? <VideoRows videos={videos} /> : null}
            {tab === 'specificity' ? (
              data?.genericEvents.length ? (
                <div className="heatmap-table">
                  {data.genericEvents.map((item) => (
                    <article className="heat-row generic" key={item.eventName}>
                      <div>
                        <span className="muted">{item.examplePage}</span>
                        <h3>{item.eventName}</h3>
                        <p>Add stable IDs or labels to this event payload.</p>
                      </div>
                      <div className="metric-set">
                        <span><strong>{formatNumber(item.count)}</strong> generic events</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="heatmap-empty">{emptyMessage('specificity')}</div>
            ) : null}
          </section>
        </div>
      </main>
    </>
  )
}

const HEATMAP_STYLES = `
.landing-heatmaps {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(227,46,46,.16), transparent 34rem),
    linear-gradient(180deg, #050505 0%, #101010 48%, #070707 100%);
  color: #f5f5f5;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
.landing-heatmaps * { box-sizing: border-box; }
.landing-heatmaps button { font-family: var(--font-sans); }
.heatmap-wrap { max-width: 1500px; margin: 0 auto; padding: 32px clamp(18px,4vw,48px) 80px; }
.heatmap-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
.heatmap-header h1 { margin: 8px 0 8px; font-size: clamp(32px,4vw,58px); line-height: .95; letter-spacing: 0; font-weight: 900; }
.heatmap-header p { margin: 0; color: #a3a3a3; font-size: 15px; line-height: 1.5; }
.back-link { color: #ffb4b4; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-decoration: none; text-transform: uppercase; }
.back-link:hover { color: #fff; }
.refresh-button,
.segmented button,
.tab-row button { border: 1px solid rgba(255,255,255,.12); color: #f8fafc; background: rgba(255,255,255,.06); border-radius: 10px; cursor: pointer; font-weight: 800; transition: transform .14s ease, border-color .14s ease, background .14s ease; }
.refresh-button { min-height: 38px; padding: 0 16px; }
.refresh-button:hover,
.segmented button:hover,
.tab-row button:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.24); background: rgba(255,255,255,.1); }
.refresh-button:disabled { cursor: wait; opacity: .65; transform: none; }
.heatmap-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.heatmap-stat { min-height: 92px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.055); border-radius: 14px; padding: 18px; box-shadow: 0 20px 50px -30px #000; }
.heatmap-stat span { display: block; color: #a3a3a3; font-size: 11px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
.heatmap-stat strong { display: block; margin-top: 10px; font-size: 30px; line-height: 1; font-weight: 900; letter-spacing: 0; }
.heatmap-stat.tone-amber strong { color: #fbbf24; }
.heatmap-stat.tone-green strong { color: #22c55e; }
.heatmap-stat.tone-blue strong { color: #60a5fa; }
.heatmap-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 0 0 18px; }
.segmented,
.tab-row { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.3); border-radius: 14px; }
.segmented.wide { flex: 1 1 520px; }
.segmented button,
.tab-row button { min-height: 32px; padding: 0 13px; font-size: 12px; color: #a3a3a3; }
.segmented button.active,
.tab-row button.active { color: #fff; border-color: rgba(227,46,46,.65); background: rgba(227,46,46,.18); box-shadow: inset 0 0 0 1px rgba(227,46,46,.12); }
.heatmap-error { margin-bottom: 14px; border: 1px solid rgba(239,68,68,.36); background: rgba(239,68,68,.12); color: #fecaca; border-radius: 12px; padding: 13px 15px; font-size: 13px; font-weight: 750; }
.page-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.page-card { min-height: 176px; display: grid; align-content: space-between; gap: 16px; border: 1px solid rgba(255,255,255,.1); background: rgba(18,18,18,.88); border-radius: 16px; padding: 18px; box-shadow: 0 22px 60px -34px #000; }
.page-card h2 { margin: 8px 0 0; font-size: 24px; line-height: 1.05; letter-spacing: 0; }
.page-path,
.muted { color: #a3a3a3; font-family: var(--font-mono); font-size: 11px; }
.page-metrics,
.event-chips,
.metric-set,
.video-metrics { display: flex; flex-wrap: wrap; gap: 8px; }
.page-metrics span,
.event-chips span,
.metric-set span,
.video-metrics span { display: inline-flex; min-height: 26px; align-items: center; border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.035); border-radius: 999px; padding: 0 9px; color: #cbd5e1; font-size: 12px; }
.event-chips.small span { min-height: 23px; font-size: 11px; }
.metric-set { justify-content: flex-end; }
.metric-set strong,
.video-metrics strong { color: #fff; margin-right: 3px; }
.heatmap-panel { border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); border-radius: 16px; padding: 14px; }
.tab-row { margin-bottom: 14px; overflow-x: auto; max-width: 100%; }
.heatmap-table { display: grid; gap: 10px; }
.heat-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, .28fr); gap: 16px; align-items: center; min-height: 98px; border: 1px solid rgba(255,255,255,.1); background: rgba(10,10,10,.62); border-radius: 14px; padding: 16px; }
.heat-row.section-row { grid-template-columns: minmax(0, 1fr) minmax(180px, .34fr) minmax(260px, .38fr); }
.heat-row.video-row { grid-template-columns: minmax(0, 1fr) minmax(240px, .4fr) minmax(260px, .38fr); }
.heat-row.generic { border-color: rgba(251,191,36,.28); background: rgba(251,191,36,.055); }
.heat-row h3 { margin: 5px 0 0; font-size: 18px; line-height: 1.2; letter-spacing: 0; }
.heat-row p { margin: 7px 0 0; color: #fbbf24; font-size: 12px; font-weight: 750; }
.heat-bar { height: 12px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,.08); }
.heat-bar span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #7f1d1d, #ef4444, #f97316, #fbbf24); box-shadow: 0 0 22px rgba(239,68,68,.35); }
.video-progress { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin-top: 12px; max-width: 340px; }
.video-progress span { min-height: 26px; display: grid; place-items: center; border-radius: 999px; border: 1px solid rgba(255,255,255,.08); color: #71717a; background: rgba(255,255,255,.035); font-family: var(--font-mono); font-size: 11px; font-weight: 900; }
.video-progress span.hit { color: #fff; border-color: rgba(34,197,94,.35); background: rgba(34,197,94,.14); }
.heatmap-empty { min-height: 160px; display: grid; place-items: center; border: 1px dashed rgba(255,255,255,.16); border-radius: 16px; color: #a3a3a3; background: rgba(255,255,255,.035); font-weight: 800; }
@media (max-width: 1100px) {
  .heatmap-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .page-grid { grid-template-columns: 1fr; }
  .heat-row,
  .heat-row.section-row,
  .heat-row.video-row { grid-template-columns: 1fr; }
  .metric-set { justify-content: flex-start; }
}
@media (max-width: 720px) {
  .heatmap-wrap { padding-inline: 14px; }
  .heatmap-header { display: grid; }
  .heatmap-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .segmented.wide { overflow-x: auto; flex-wrap: nowrap; }
}
`
