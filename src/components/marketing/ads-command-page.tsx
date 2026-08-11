'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  DROP_LABEL,
  MICRO_STEPS,
  STAGES,
  type CampaignRow,
  type ExportHealth,
  type IconName,
  type KpiItem,
  type CallBreakdownRow,
  type FunnelBreakdownRow,
  type FunnelRow,
  type KeywordRow,
  type LeadRow,
  type MarketingPeriod,
  type NegativeKeywordRow,
  type OutboxRow,
  type PaidSessionRow,
  type SeriesRow,
} from '@/lib/marketing/ads-command-seed'
import { EMPTY_CLICK_CAPTURE_HEALTH, type ClickCaptureHealth, type ClickCaptureSourceHealth } from '@/lib/marketing/click-capture-health'
import { paidClickCount } from '@/lib/marketing/paid-click-count'
import { EMPTY_TRAFFIC_QUALITY_REPORT, type TrafficQualityReport, type TrafficQualityStatus } from '@/lib/marketing/traffic-quality'

type MetricKey = 'spend' | 'cpl' | 'leads' | 'qualified' | 'clicks' | 'conversions'
type CampaignView = 'campaign' | 'type'
type KeywordTab = 'terms' | 'neg'
type SortKey = 'kw' | 'campaign' | 'clicks' | 'leads' | 'cpl' | 'qual' | 'status'
type SortDir = 'asc' | 'desc'
type PaidFilter = 'all' | 'lead' | 'nolead'
type PaidRange = MarketingPeriod | 'all'
type PeriodState = {
  trend: MarketingPeriod
  funnel: MarketingPeriod
  camp: MarketingPeriod
  kw: MarketingPeriod
  roster: MarketingPeriod
  outbox: MarketingPeriod
}
type DashboardSectionId =
  | 'kpis'
  | 'trafficQuality'
  | 'clickCaptureHealth'
  | 'trend'
  | 'campaigns'
  | 'searchTerms'
  | 'funnel'
  | 'exportHealth'
  | 'heatmaps'
  | 'roster'
  | 'outbox'
  | 'paidJourneys'
type DashboardSectionSize = 'full' | 'half'

const SEARCH_TERM_PAGE_SIZE = 10
const OUTBOX_PAGE_SIZE = 5
const EMPTY_CAMPAIGNS: CampaignRow[] = []
const EMPTY_EXPORT_HEALTH: ExportHealth = {
  total: 0,
  pending: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  repairedKnownSkips: 0,
  lastSuccessfulExport: null,
  lastSuccessfulEvent: null,
  lastSuccessfulLead: null,
  lastFailureReason: null,
  lastFailureAt: null,
  lastFailureEvent: null,
  status: 'clean',
}
const SECTION_ORDER_STORAGE_KEY = 'google-ads-section-order-v2'
const SECTION_COLLAPSE_STORAGE_KEY = 'google-ads-section-collapse-v2'
const DEFAULT_SECTION_ORDER: DashboardSectionId[] = ['kpis', 'trafficQuality', 'clickCaptureHealth', 'trend', 'campaigns', 'searchTerms', 'funnel', 'exportHealth', 'heatmaps', 'roster', 'outbox', 'paidJourneys']
const DEFAULT_COLLAPSED_SECTIONS: Record<DashboardSectionId, boolean> = {
  kpis: false,
  trafficQuality: false,
  clickCaptureHealth: false,
  trend: false,
  campaigns: false,
  searchTerms: false,
  funnel: false,
  exportHealth: false,
  heatmaps: false,
  roster: false,
  outbox: false,
  paidJourneys: false,
}
const DASHBOARD_SECTIONS: Record<DashboardSectionId, { label: string; size: DashboardSectionSize }> = {
  kpis: { label: 'KPI Row', size: 'full' },
  trafficQuality: { label: 'Traffic Quality', size: 'full' },
  clickCaptureHealth: { label: 'Click Capture', size: 'full' },
  trend: { label: 'Performance Trend', size: 'full' },
  campaigns: { label: 'Conversions by Campaign', size: 'half' },
  searchTerms: { label: 'Search Term Performance', size: 'half' },
  funnel: { label: 'Marketing Funnel', size: 'full' },
  exportHealth: { label: 'Google Ads Export Health', size: 'full' },
  heatmaps: { label: 'Google Ads Landing Pages', size: 'full' },
  roster: { label: 'Google Ads Lead Roster', size: 'full' },
  outbox: { label: 'Google Ads Conversion Outbox', size: 'full' },
  paidJourneys: { label: 'Google Ads Journeys', size: 'full' },
}

type MarketingBreakdown = {
  title: string
  subtitle: string
  metricLabel: string
  total: number
  items: FunnelBreakdownRow[]
}
type CallDisplayRow = CallBreakdownRow & {
  scaledValue: number
}
type AdsCommandData = {
  source: 'live'
  paidSourceFilter: 'google_ads'
  generatedAt: string
  syncedLabel: string
  freshness: {
    dashboardGeneratedAt: string
    liveTrackingUpdatedAt: string | null
    googleAdsImportedAt: string | null
    googleAdsSyncStatus: string | null
    googleAdsSyncFinishedAt: string | null
  }
  kpi: KpiItem[]
  series: SeriesRow[]
  campaigns: CampaignRow[]
  keywords: KeywordRow[]
  negatives: NegativeKeywordRow[]
  funnel: FunnelRow[]
  callBreakdown: CallBreakdownRow[]
  exportHealth: ExportHealth
  leads: LeadRow[]
  outbox: OutboxRow[]
  paidSessions: PaidSessionRow[]
  captureHealth: ClickCaptureHealth
  trafficQuality: TrafficQualityReport
}

const PERIODS: Record<MarketingPeriod, { l: string; days: number; hourly?: boolean; offset?: number }> = {
  today: { l: 'Today', days: 1, hourly: true },
  yesterday: { l: 'Yesterday', days: 1, hourly: true, offset: 1 },
  week: { l: 'Week', days: 7 },
  month: { l: 'Month', days: 30 },
  qtr: { l: 'Qtr', days: 90 },
  ytd: { l: 'YTD', days: 150 },
}

const PERIOD_OPTIONS: Array<{ value: MarketingPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'qtr', label: 'Qtr' },
  { value: 'ytd', label: 'YTD' },
]
const DASHBOARD_TIME_ZONE = 'America/Chicago'

function subscribeHydration(callback: () => void): () => void {
  const frame = window.requestAnimationFrame(callback)
  return () => window.cancelAnimationFrame(frame)
}

function clientHydrationSnapshot(): boolean {
  return true
}

function serverHydrationSnapshot(): boolean {
  return false
}

function isDashboardSectionId(value: string): value is DashboardSectionId {
  return value in DASHBOARD_SECTIONS
}

function normalizeSectionOrder(value: unknown): DashboardSectionId[] {
  if (!Array.isArray(value)) return DEFAULT_SECTION_ORDER
  const seen = new Set<DashboardSectionId>()
  const saved = value.filter((item): item is DashboardSectionId => {
    if (typeof item !== 'string' || !isDashboardSectionId(item) || seen.has(item)) return false
    seen.add(item)
    return true
  })
  return [...saved, ...DEFAULT_SECTION_ORDER.filter((item) => !seen.has(item))]
}

function collapsedSectionsFromStorage(value: unknown): Record<DashboardSectionId, boolean> {
  if (!Array.isArray(value)) return DEFAULT_COLLAPSED_SECTIONS
  const collapsed = { ...DEFAULT_COLLAPSED_SECTIONS }
  for (const item of value) {
    if (typeof item === 'string' && isDashboardSectionId(item)) collapsed[item] = true
  }
  return collapsed
}

function collapsedSectionIds(collapsed: Record<DashboardSectionId, boolean>): DashboardSectionId[] {
  return DEFAULT_SECTION_ORDER.filter((item) => collapsed[item])
}

function moveSection(order: DashboardSectionId[], source: DashboardSectionId, target: DashboardSectionId, placeAfter: boolean): DashboardSectionId[] {
  if (source === target) return order
  const withoutSource = order.filter((item) => item !== source)
  const targetIndex = withoutSource.indexOf(target)
  if (targetIndex < 0) return order
  const insertIndex = targetIndex + (placeAfter ? 1 : 0)
  return [
    ...withoutSource.slice(0, insertIndex),
    source,
    ...withoutSource.slice(insertIndex),
  ]
}

const TREND_PERIOD_OPTIONS: Array<{ value: MarketingPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'qtr', label: 'Quarter' },
  { value: 'ytd', label: 'YTD' },
]

const METRICS: Record<MetricKey, { label: string; color: string; axis: 'y' | 'y1'; fmt: (value: number) => string }> = {
  spend: { label: 'Spend', color: '#f87171', axis: 'y', fmt: formatUsd },
  cpl: { label: 'CPL', color: '#14b8a6', axis: 'y', fmt: formatUsd },
  leads: { label: 'Leads', color: '#22c55e', axis: 'y1', fmt: formatNum },
  qualified: { label: 'Opportunities', color: '#eab308', axis: 'y1', fmt: formatNum },
  clicks: { label: 'Clicks', color: '#a1a1aa', axis: 'y1', fmt: formatNum },
  conversions: { label: 'Conversions', color: '#60a5fa', axis: 'y1', fmt: formatNum },
}

const ICON: Record<IconName, string> = {
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
  page: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  spark: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
  phone: '<path d="M5 4h4l2 5-3 2a12 12 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  chat: '<path d="M21 12a8 8 0 01-11 7l-5 2 1.5-4.5A8 8 0 1121 12z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  cal: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/>',
  doc: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>',
  sign: '<path d="M3 17s3-6 7-6 4 4 8 1"/><path d="M3 21h18"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2V9z"/>',
  pin: '<path d="M12 22s-7-7.5-7-13a7 7 0 1114 0c0 5.5-7 13-7 13z"/><circle cx="12" cy="9" r="2.5"/>',
  user: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  exit: '<path d="M16 17l5-5-5-5M21 12H9M13 21H5a2 2 0 01-2-2V5a2 2 0 012-2h8"/>',
  scroll: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/>',
}

const XP = [5, 15, 20, 40, 30, 25, 45, 80, 70, 90, 150, 250]

function formatUsd(value: number): string {
  return `$${Math.round(value).toLocaleString()}`
}

function formatK(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`
  return formatUsd(value)
}

function formatNum(value: number): string {
  return Math.round(value).toLocaleString()
}

function formatFreshness(value: string | null | undefined): string {
  if (!value) return 'waiting'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'waiting'
  return date.toLocaleString('en-US', {
    timeZone: DASHBOARD_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatKpi(value: number, fmt: KpiItem['fmt']): string {
  if (fmt === 'usd') return formatUsd(value)
  if (fmt === 'k') return formatK(value)
  return formatNum(value)
}

function kpiValue(rows: KpiItem[], label: string): number {
  return rows.find((row) => row.lab.toLowerCase() === label.toLowerCase())?.val ?? 0
}

function scaleN(value: number, period: MarketingPeriod): number {
  void period
  return Math.max(0, Math.round(value))
}

function scaleBreakdownItems(items: FunnelBreakdownRow[], period: MarketingPeriod): FunnelBreakdownRow[] {
  void period
  return items.map((item) => ({ ...item, value: Math.max(0, Math.round(item.value)) }))
}

function shareOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function breakdownTotal(items: FunnelBreakdownRow[]): number {
  return items.reduce((sum, item) => sum + item.value, 0)
}

function topBreakdown(items: FunnelBreakdownRow[]): string {
  const total = breakdownTotal(items)
  const top = [...items].sort((a, b) => b.value - a.value)[0]
  if (!top) return 'No detail'
  return `${top.label} ${top.value.toLocaleString()} (${shareOf(top.value, total)}%)`
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180
  return {
    x: Number((cx + radius * Math.cos(radians)).toFixed(3)),
    y: Number((cy + radius * Math.sin(radians)).toFixed(3)),
  }
}

function svgNumber(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function normalizeSvgAngle(angle: number): number {
  return ((angle % 360) + 360) % 360
}

function angleInSegment(angle: number, start: number, end: number): boolean {
  const target = normalizeSvgAngle(angle)
  const from = normalizeSvgAngle(start)
  const to = normalizeSvgAngle(end)
  return from <= to ? target >= from && target <= to : target >= from || target <= to
}

function donutArcPath(cx: number, cy: number, outerRadius: number, innerRadius: number, startAngle: number, endAngle: number) {
  const outerStart = polarPoint(cx, cy, outerRadius, endAngle)
  const outerEnd = polarPoint(cx, cy, outerRadius, startAngle)
  const innerStart = polarPoint(cx, cy, innerRadius, startAngle)
  const innerEnd = polarPoint(cx, cy, innerRadius, endAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'

  return [
    `M ${svgNumber(outerStart.x)} ${svgNumber(outerStart.y)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${svgNumber(outerEnd.x)} ${svgNumber(outerEnd.y)}`,
    `L ${svgNumber(innerStart.x)} ${svgNumber(innerStart.y)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${svgNumber(innerEnd.x)} ${svgNumber(innerEnd.y)}`,
    'Z',
  ].join(' ')
}

const CALL_LABEL_LAYOUT: Record<string, { x: number; y: number; anchor: 'start' | 'end' }> = {
  'Back taxes': { x: 338, y: 78, anchor: 'start' },
  Inherited: { x: 116, y: 78, anchor: 'end' },
  'Tired landlord': { x: 118, y: 244, anchor: 'end' },
  'Fast cash offer': { x: 332, y: 246, anchor: 'start' },
  'Vacant / repairs': { x: 352, y: 162, anchor: 'start' },
}

const CALL_DONUT_ORDER = ['Back taxes', 'Vacant / repairs', 'Fast cash offer', 'Tired landlord', 'Inherited']

function CallsDonut({
  rows,
  total,
  onOpenBreakdown,
}: {
  rows: CallDisplayRow[]
  total: number
  onOpenBreakdown: (row: CallDisplayRow) => void
}) {
  const cx = 224
  const cy = 160
  const outerRadius = 88
  const innerRadius = 54
  const gap = 4.5
  const segments = rows.reduce<{ cursor: number; items: Array<{ row: CallDisplayRow; start: number; end: number; mid: number }> }>((acc, row) => {
    const rawSpan = (row.scaledValue / total) * 360
    const start = acc.cursor + gap / 2
    const end = acc.cursor + Math.max(7, rawSpan - gap / 2)
    return {
      cursor: acc.cursor + rawSpan,
      items: [...acc.items, { row, start, end, mid: start + (end - start) / 2 }],
    }
  }, { cursor: -21, items: [] }).items

  const handleDonutClick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 448
    const y = ((event.clientY - rect.top) / rect.height) * 320
    const radius = Math.hypot(x - cx, y - cy)
    if (radius < innerRadius - 8 || radius > outerRadius + 14) return

    const angle = Math.atan2(y - cy, x - cx) * (180 / Math.PI) + 90
    const segment = segments.find(({ start, end }) => angleInSegment(angle, start, end))
    if (segment) onOpenBreakdown(segment.row)
  }

  return (
    <div className="calls-donut" aria-label={`Calls by seller situation, ${total} total calls`}>
      <svg viewBox="0 0 448 320" role="group" aria-label="Calls breakdown chart" onClick={handleDonutClick}>
        <defs>
          <filter id="callGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.18 0 0 0 0 0.9 0 0 0 0 0.78 0 0 0 .38 0" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="callCenter" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="var(--surface-2)" />
            <stop offset="70%" stopColor="var(--surface)" />
            <stop offset="100%" stopColor="var(--surface-2)" />
          </radialGradient>
        </defs>
        <circle className="calls-donut-decor" cx={cx} cy={cy} r={outerRadius + 12} fill="var(--surface-2)" />
        <circle className="calls-donut-decor" cx={cx} cy={cy} r={outerRadius + 2} fill="none" stroke="var(--line)" strokeWidth="1" />
        {segments.map(({ row, start, end }) => (
          <path
            key={row.label}
            d={donutArcPath(cx, cy, outerRadius, innerRadius, start, end)}
            className="calls-donut-seg"
            fill={row.color}
            filter="url(#callGlow)"
            onClick={(event) => {
              event.stopPropagation()
              onOpenBreakdown(row)
            }}
            role="button"
            tabIndex={0}
            aria-label={`${row.label}: ${row.scaledValue} calls, ${shareOf(row.scaledValue, total)}%`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onOpenBreakdown(row)
            }}
          />
        ))}
        <circle className="calls-donut-decor" cx={cx} cy={cy} r="62" fill="rgba(0,0,0,.52)" />
        <circle className="calls-donut-decor" cx={cx} cy={cy} r="54" fill="url(#callCenter)" stroke="var(--line-2)" strokeWidth="1.3" />
        <circle className="calls-donut-decor" cx={cx} cy={cy} r="47" fill="none" stroke="var(--line)" strokeWidth="1" />
        <text x={cx} y={cy - 8} textAnchor="middle" className="calls-donut-total-label">TOTAL</text>
        <text x={cx} y={cy + 19} textAnchor="middle" className="calls-donut-total">{total}</text>
        {segments.map(({ row, mid }) => {
          const pct = shareOf(row.scaledValue, total)
          const layout = CALL_LABEL_LAYOUT[row.label] || { x: mid > 180 ? 105 : 343, y: cy, anchor: mid > 180 ? 'end' as const : 'start' as const }
          const edge = polarPoint(cx, cy, outerRadius + 5, mid)
          const bendX = layout.anchor === 'start' ? layout.x - 26 : layout.x + 26
          const dotX = layout.anchor === 'start' ? layout.x - 8 : layout.x + 8

          return (
            <g className="calls-donut-label" key={`${row.label}-label`}>
              <path d={`M ${edge.x} ${edge.y} L ${bendX} ${layout.y} L ${dotX} ${layout.y}`} stroke={row.color} strokeWidth="1.7" fill="none" />
              <circle cx={edge.x} cy={edge.y} r="3.2" fill={row.color} />
              <text x={layout.x} y={layout.y - 5} textAnchor={layout.anchor} className="calls-donut-label-name">
                {row.label}
              </text>
              <text x={layout.x} y={layout.y + 13} textAnchor={layout.anchor} className="calls-donut-label-value">
                {row.scaledValue} ({pct}%)
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function scoreColor(verdict: LeadRow['verdict']): string {
  if (verdict === 'FAVORITE') return '#22c55e'
  if (verdict === 'FOOL') return '#f87171'
  return '#eab308'
}

function SvgIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICON[name] }}
    />
  )
}

function PeriodSelect({
  value,
  onChange,
  options = PERIOD_OPTIONS,
  label,
}: {
  value: MarketingPeriod
  onChange: (period: MarketingPeriod) => void
  options?: Array<{ value: MarketingPeriod; label: string }>
  label: string
}) {
  return (
    <span className="date-pill">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as MarketingPeriod)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}

function KpiCard({ item, index }: { item: KpiItem; index: number }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const start = performance.now()
    const duration = 920
    let frame = 0

    function step(now: number) {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3.2)
      setDisplay(item.val * eased)
      if (progress < 1) frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [item.val])

  const arrow = item.delta >= 0 ? '↑' : '↓'
  const cls = item.good ? (item.delta >= 0 ? 'up' : 'down') : item.delta >= 0 ? 'down' : 'up'

  return (
    <div className="kpi" style={{ animationDelay: `${index * 35}ms` }}>
      <div className="label">{item.lab}</div>
      <div className="value mono">{formatKpi(display, item.fmt)}</div>
      <div className={`delta ${cls}`}>
        {arrow} {Math.abs(item.delta)}%
      </div>
    </div>
  )
}

function getTrendRows(period: MarketingPeriod, series: SeriesRow[]): SeriesRow[] {
  const cfg = PERIODS[period]
  if (cfg.hourly) return series.slice(-1)
  return series.slice(-cfg.days)
}

function PerformanceTrend({
  period,
  activeSeries,
  series,
  onPeriodChange,
  onToggleSeries,
}: {
  period: MarketingPeriod
  activeSeries: MetricKey[]
  series: SeriesRow[]
  onPeriodChange: (period: MarketingPeriod) => void
  onToggleSeries: (metric: MetricKey) => void
}) {
  const rows = useMemo(() => getTrendRows(period, series), [period, series])
  const gradientColor = METRICS[activeSeries[0]].color

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Performance Trend</h2>
          <div className="cap">Up to 3 metrics — click chips to toggle</div>
        </div>
        <div className="panel-actions">
          <div className="series-chips">
            {(Object.keys(METRICS) as MetricKey[]).map((key) => {
              const metric = METRICS[key]
              const on = activeSeries.includes(key)
              const disabled = activeSeries.length >= 3 && !on
              return (
                <button
                  key={key}
                  className={`schip${on ? ' on' : ''}${disabled ? ' disabled' : ''}`}
                  style={on ? { color: metric.color } : undefined}
                  onClick={() => onToggleSeries(key)}
                  type="button"
                  disabled={disabled}
                >
                  <i style={{ background: metric.color }} />
                  {metric.label}
                </button>
              )
            })}
          </div>
          <PeriodSelect value={period} onChange={onPeriodChange} options={TREND_PERIOD_OPTIONS} label="Trend period" />
        </div>
      </div>
      <div className="chartbox">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 800, height: 300 }}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={gradientColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={gradientColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="y" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickLine={false} axisLine={false} width={46} />
            <YAxis yAxisId="y1" orientation="right" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--text)' }}
              formatter={(value, name) => METRICS[name as MetricKey].fmt(Number(value))}
            />
            {activeSeries.map((key, index) => {
              const metric = METRICS[key]
              if (index === 0) {
                return (
                  <Area
                    key={key}
                    yAxisId={metric.axis}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stroke={metric.color}
                    strokeWidth={2.5}
                    fill="url(#trendFill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )
              }
              return (
                <Line
                  key={key}
                  yAxisId={metric.axis}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stroke={metric.color}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function CampaignChart({
  period,
  view,
  campaigns,
  onPeriodChange,
  onViewChange,
}: {
  period: MarketingPeriod
  view: CampaignView
  campaigns: CampaignRow[]
  onPeriodChange: (period: MarketingPeriod) => void
  onViewChange: (view: CampaignView) => void
}) {
  const rows = useMemo(
    () =>
      campaigns.map((campaign) => ({
        ...campaign,
        leadsScaled: scaleN(campaign.leads, period),
        clicksScaled: scaleN(campaign.clicks ?? 0, period),
        spendScaled: scaleN(campaign.spend, period),
        callScaled: scaleN(campaign.call, period),
        formScaled: scaleN(campaign.form, period),
        smsScaled: scaleN(campaign.sms, period),
      })),
    [campaigns, period],
  )
  const hasAttributedLeads = rows.some((row) => row.leadsScaled > 0 || row.callScaled > 0 || row.formScaled > 0 || row.smsScaled > 0)
  const hasPaidCampaignData = rows.some((row) => row.clicksScaled > 0 || row.spendScaled > 0)

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Conversions by Campaign</h2>
          <div className="cap">Attributed leads</div>
        </div>
        <div className="panel-actions compact">
          <div className="seg">
            <button className={view === 'campaign' ? 'on' : ''} onClick={() => onViewChange('campaign')} type="button">
              Campaign
            </button>
            <button className={view === 'type' ? 'on' : ''} onClick={() => onViewChange('type')} type="button">
              By Type
            </button>
          </div>
          <PeriodSelect value={period} onChange={onPeriodChange} label="Campaign period" />
        </div>
      </div>
      <div className="chartbox sm">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 800, height: 300 }}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--line)" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={150}
            />
            <Tooltip
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--text)' }}
              formatter={(value, name) => {
                const label = name === 'leadsScaled' ? 'Leads' : String(name).replace('Scaled', '')
                return [value, label]
              }}
            />
            {view === 'campaign' ? (
              <Bar dataKey="leadsScaled" radius={[0, 7, 7, 0]} barSize={17}>
                {rows.map((row) => (
                  <Cell key={row.name} fill={row.color} />
                ))}
              </Bar>
            ) : (
              <>
                <Bar dataKey="callScaled" name="Call" stackId="s" fill="#f87171" radius={[0, 5, 5, 0]} />
                <Bar dataKey="formScaled" name="Form" stackId="s" fill="#22c55e" radius={[0, 5, 5, 0]} />
                <Bar dataKey="smsScaled" name="SMS" stackId="s" fill="#eab308" radius={[0, 5, 5, 0]} />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
        {!hasAttributedLeads && hasPaidCampaignData ? (
          <div className="chart-note">
            <b>0 attributed leads in this period.</b>
            <span>Spend and clicks are imported; bars appear after a CRM lead or call conversion is attributed.</span>
          </div>
        ) : null}
      </div>
      {rows.length ? (
        <div className="campaign-source-list">
          {rows.slice(0, 6).map((row) => (
            <div className="campaign-source-row" key={`${row.source ?? 'Paid'}-${row.name}`}>
              <span><i style={{ background: row.color }} /><span className="source-tag">{row.source ?? 'Google Ads'}</span>{row.name}</span>
              <b className="mono">{row.leadsScaled} leads · {formatNum(row.clicksScaled)} clicks · {formatUsd(row.spendScaled)}</b>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state campaign-empty">No campaign rows for this source and period.</div>
      )}
    </div>
  )
}

function SearchTerms({
  period,
  tab,
  campaignFilter,
  campaignOptions,
  keywords,
  negatives,
  sortKey,
  sortDir,
  onPeriodChange,
  onTabChange,
  onCampaignFilterChange,
  onSort,
}: {
  period: MarketingPeriod
  tab: KeywordTab
  campaignFilter: string
  campaignOptions: string[]
  keywords: KeywordRow[]
  negatives: NegativeKeywordRow[]
  sortKey: SortKey
  sortDir: SortDir
  onPeriodChange: (period: MarketingPeriod) => void
  onTabChange: (tab: KeywordTab) => void
  onCampaignFilterChange: (campaign: string) => void
  onSort: (key: SortKey) => void
}) {
  const isNeg = tab === 'neg'
  const cols: Array<[SortKey | 'act', string]> = isNeg
    ? [['kw', 'Negative Keyword'], ['campaign', 'Campaign'], ['clicks', 'Wasted Clicks'], ['leads', 'Leads'], ['status', 'Status']]
    : [['kw', 'Keyword'], ['campaign', 'Campaign'], ['clicks', 'Clicks'], ['leads', 'Leads'], ['cpl', 'CPL'], ['qual', 'Qual %']]
  const effectiveSortDir = !isNeg && sortKey === 'leads' ? 'desc' : sortDir
  const rows = useMemo(() => {
    const source = (isNeg ? negatives : keywords)
      .filter((row) => campaignFilter === 'all' || row.campaign === campaignFilter || row.campaign === 'All Campaigns')
      .map((row) => ({
        ...row,
        clicks: scaleN(row.clicks, period),
        leads: scaleN(row.leads, period),
      }))

    return source.sort((a, b) => {
      const x = sortKey === 'status' && 'status' in a ? a.status : a[sortKey as keyof typeof a]
      const y = sortKey === 'status' && 'status' in b ? b.status : b[sortKey as keyof typeof b]
      if (typeof x === 'string' && typeof y === 'string') return effectiveSortDir === 'desc' ? y.localeCompare(x) : x.localeCompare(y)
      return effectiveSortDir === 'desc' ? Number(y) - Number(x) : Number(x) - Number(y)
    })
  }, [campaignFilter, effectiveSortDir, isNeg, keywords, negatives, period, sortKey])
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / SEARCH_TERM_PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const start = safePage * SEARCH_TERM_PAGE_SIZE
  const pageRows = rows.slice(start, start + SEARCH_TERM_PAGE_SIZE)

  const resetPage = () => {
    setPage(0)
  }

  const handleTabChange = (nextTab: KeywordTab) => {
    resetPage()
    onTabChange(nextTab)
  }

  const handleCampaignFilterChange = (campaign: string) => {
    resetPage()
    onCampaignFilterChange(campaign)
  }

  const handlePeriodChange = (nextPeriod: MarketingPeriod) => {
    resetPage()
    onPeriodChange(nextPeriod)
  }

  const handleSort = (key: SortKey) => {
    resetPage()
    onSort(key)
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Search Term Performance</h2>
          <div className="cap">CPL vs $25K floor • sort by clicking headers</div>
        </div>
        <div className="panel-actions compact">
          <div className="seg">
            <button className={tab === 'terms' ? 'on' : ''} onClick={() => handleTabChange('terms')} type="button">
              Terms
            </button>
            <button className={tab === 'neg' ? 'on' : ''} onClick={() => handleTabChange('neg')} type="button">
              Negatives
            </button>
          </div>
          <select
            className="gsel campaign-filter"
            aria-label="Search term campaign"
            value={campaignFilter}
            onChange={(event) => handleCampaignFilterChange(event.target.value)}
          >
            <option value="all">All Campaigns</option>
            {campaignOptions.map((campaign) => (
              <option key={campaign} value={campaign}>{campaign}</option>
            ))}
          </select>
          <PeriodSelect value={period} onChange={handlePeriodChange} label="Keyword period" />
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {cols.map(([key, label]) => {
                if (key === 'act') return <th key={key} />
                const sortable = key !== 'status'
                return (
                  <th key={key} className={sortable ? 'sortable' : ''} onClick={sortable ? () => handleSort(key) : undefined}>
                    {label}
                    {sortKey === key ? <span>{effectiveSortDir === 'desc' ? ' ↓' : ' ↑'}</span> : null}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="empty-table" colSpan={cols.length}>No search terms for this campaign.</td>
              </tr>
            ) : pageRows.map((row) => {
              if ('status' in row) {
                return (
                  <tr key={row.kw}>
                    <td className="kw">{row.kw}</td>
                    <td className="campaign-cell">{row.campaign}</td>
                    <td>{row.clicks}</td>
                    <td>{row.leads}</td>
                    <td>
                      <span style={{ color: row.status === 'active' ? '#f87171' : '#eab308' }}>
                        {row.status === 'active' ? '● Active' : '◌ Suggested'}
                      </span>
                    </td>
                  </tr>
                )
              }
              const good = row.cpl <= 100
              return (
                <tr key={row.kw}>
                  <td className="kw">{row.kw}</td>
                  <td className="campaign-cell">{row.campaign}</td>
                  <td>{row.clicks}</td>
                  <td>{row.leads}</td>
                  <td style={{ color: good ? '#22c55e' : '#f87171' }}>${row.cpl}</td>
                  <td>{row.qual}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > SEARCH_TERM_PAGE_SIZE ? (
        <div className="keyword-pager">
          <span>{`${start + 1}-${Math.min(start + SEARCH_TERM_PAGE_SIZE, rows.length)} of ${rows.length}`}</span>
          <div className="keyword-pager-actions">
            <button className="pager-btn" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)} type="button">←</button>
            <button className="pager-btn" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} type="button">→</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function makeFunnelBreakdown(step: FunnelRow, period: MarketingPeriod): MarketingBreakdown {
  const items = scaleBreakdownItems(step.breakdown, period)
  return {
    title: step.name,
    subtitle: step.breakdownLabel,
    metricLabel: step.name === 'Impressions' ? 'impressions' : step.name === 'Opportunity' ? 'opportunities' : 'clicks',
    total: step.name === 'Impressions' || step.name === 'Leads' || step.name === 'Opportunity'
      ? scaleN(step.n, period)
      : breakdownTotal(items),
    items,
  }
}

function makeCallBreakdown(row: CallBreakdownRow, period: MarketingPeriod): MarketingBreakdown {
  const items = scaleBreakdownItems(row.details, period)
  return {
    title: `Calls - ${row.label}`,
    subtitle: 'Call source breakdown',
    metricLabel: 'calls',
    total: scaleN(row.value, period),
    items,
  }
}

function MarketingFunnel({
  period,
  funnel,
  callBreakdown,
  onPeriodChange,
  onOpenBreakdown,
}: {
  period: MarketingPeriod
  funnel: FunnelRow[]
  callBreakdown: CallBreakdownRow[]
  onPeriodChange: (period: MarketingPeriod) => void
  onOpenBreakdown: (breakdown: MarketingBreakdown) => void
}) {
  const [activeStepName, setActiveStepName] = useState('Situation')
  const activeStep = funnel.find((step) => step.name === activeStepName) || funnel[2] || funnel[0]
  const callRows = callBreakdown.map((row) => ({
    ...row,
    scaledValue: scaleN(row.value, period),
  })).sort((a, b) => CALL_DONUT_ORDER.indexOf(a.label) - CALL_DONUT_ORDER.indexOf(b.label))
  const callTotal = callRows.reduce((sum, row) => sum + row.scaledValue, 0)

  function openFunnelStep(step: FunnelRow) {
    setActiveStepName(step.name)
    onOpenBreakdown(makeFunnelBreakdown(step, period))
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Marketing Funnel</h2>
          <div className="cap">Table and pie breakdowns - click any row, slice, or legend item for details</div>
        </div>
        <PeriodSelect value={period} onChange={onPeriodChange} label="Funnel period" />
      </div>
      <div className="funnel-v2">
        <section className="funnel-block form-block" aria-label="Form funnel breakdown">
          <div className="funnel-block-head">
            <div>
              <h3>Form Funnel</h3>
              <p>Stage volume, step rate, and the largest detail bucket.</p>
            </div>
          </div>
          <div className="funnel-content">
            <div className="funnel-table-v2" role="table" aria-label="Marketing funnel table">
              <div className="ft-row ft-head" role="row">
                <span role="columnheader">Stage</span>
                <span role="columnheader">Volume</span>
                <span role="columnheader">Rate</span>
                <span role="columnheader">Top Detail</span>
              </div>
              {funnel.map((step, index) => {
                const scaled = scaleN(step.n, period)
                const prev = index > 0 ? scaleN(funnel[index - 1].n, period) : null
                const conv = prev != null && prev > 0 ? shareOf(scaled, prev) : null
                const items = scaleBreakdownItems(step.breakdown, period)
                return (
                  <button
                    className={`ft-row${activeStep.name === step.name ? ' active' : ''}`}
                    key={step.name}
                    onClick={() => openFunnelStep(step)}
                    role="row"
                    type="button"
                  >
                    <span role="cell">
                      <i style={{ background: step.c }} />
                      {step.name}
                    </span>
                    <span className="mono" role="cell">{scaled.toLocaleString()}</span>
                    <span className="mono" role="cell">{conv != null ? `${conv}%` : '-'}</span>
                    <span role="cell">{topBreakdown(items)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <section className="funnel-block calls-block" aria-label="Calls breakdown">
          <div className="funnel-block-head">
            <div>
              <h3>Calls</h3>
              <p>Call mix by seller situation.</p>
            </div>
            <div className="call-total mono">{callTotal} calls</div>
          </div>
          <div className="calls-content">
            <CallsDonut rows={callRows} total={callTotal} onOpenBreakdown={(row) => onOpenBreakdown(makeCallBreakdown(row, period))} />
            <div className="call-list">
              {callRows.map((row) => (
                <button key={row.label} type="button" onClick={() => onOpenBreakdown(makeCallBreakdown(row, period))}>
                  <span><i style={{ background: row.color }} />{row.label}</span>
                  <b className="mono">{row.scaledValue}</b>
                  <em>{shareOf(row.scaledValue, callTotal)}%</em>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function ActiveLeadRoster({
  leads,
  period,
  onPeriodChange,
  onOpenLead,
}: {
  leads: LeadRow[]
  period: MarketingPeriod
  onPeriodChange: (period: MarketingPeriod) => void
  onOpenLead: (lead: LeadRow) => void
}) {
  const cap = PERIODS[period].days
  const subset = leads.filter((lead) => lead.days <= cap)

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Active Lead Roster</h2>
          <div className="cap">Google Ads leads attributed from Search campaigns • open a lead to inspect its complete journey</div>
        </div>
        <PeriodSelect value={period} onChange={onPeriodChange} label="Roster period" />
      </div>
      <div className="roster">
        {subset.length === 0 ? (
          <div className="empty-state">No leads entered the pipeline in this period.</div>
        ) : (
          subset.map((lead) => {
            const stageIdx = Math.min(lead.progress, STAGES.length - 1)
            const color = scoreColor(lead.verdict)
            return (
              <button className="lead" key={lead.id} type="button" onClick={() => onOpenLead(lead)}>
                <span className="play">▶</span>
                <span className="lead-header">
                  <span className="name">{lead.name}</span>
                  <span className="lead-status" style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}>
                    {STAGES[stageIdx].name}
                  </span>
                </span>
                <span className="meta">{lead.county} · {lead.prop}</span>
                <span className="kw">
                  <SvgIcon name="cursor" size={11} /> <span className="source-tag">{lead.source ?? 'Google Ads'}</span> {lead.kw}
                </span>
                <span className="lead-metrics">
                  <span>
                    <span className="mini-label">SPREAD</span>
                    <span className="spread mono">{formatUsd(lead.spread)}</span>
                  </span>
                  <span className="score">
                    <span className="score-label">SCORE</span>
                    <span className="val mono" style={{ color }}>
                      {lead.score}
                    </span>
                  </span>
                </span>
                <span className="miniprog">
                  <span style={{ width: `${(lead.progress / (STAGES.length - 1)) * 100}%` }} />
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function outboxTone(row: OutboxRow): string {
  const status = row.status.toLowerCase()
  if (row.dryRun) return '#a78bfa'
  if (!row.exportable) return '#a1a1aa'
  if (status.includes('sent')) return '#22c55e'
  if (status.includes('failed') || status.includes('dead')) return '#f87171'
  if (status.includes('approval')) return '#eab308'
  if (status.includes('processing')) return '#60a5fa'
  return '#14b8a6'
}

function outboxTime(row: OutboxRow): string {
  const date = new Date(row.eventTime)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('en-US', { timeZone: DASHBOARD_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function exportHealthTone(status: ExportHealth['status']): string {
  if (status === 'attention') return '#f87171'
  if (status === 'watch') return '#eab308'
  return '#22c55e'
}

function exportHealthLabel(status: ExportHealth['status']): string {
  if (status === 'attention') return 'Needs attention'
  if (status === 'watch') return 'Watch queue'
  return 'Clean'
}

function ExportHealthCard({ health }: { health: ExportHealth }) {
  const tone = exportHealthTone(health.status)
  return (
    <div className="panel export-health-panel">
      <div className="panel-head">
        <div>
          <h2>Google Ads Export Health</h2>
          <div className="cap">Opportunity, appointment, and call conversion delivery to Google Ads</div>
        </div>
        <span className="export-health-state" style={{ color: tone, borderColor: `${tone}55`, background: `${tone}16` }}>
          {exportHealthLabel(health.status)}
        </span>
      </div>
      <div className="export-health-grid">
        <div className="export-health-metric"><span>PENDING</span><b className="mono blue">{health.pending}</b></div>
        <div className="export-health-metric"><span>SENT</span><b className="mono green">{health.sent}</b></div>
        <div className="export-health-metric"><span>SKIPPED</span><b className="mono">{health.skipped}</b></div>
        <div className="export-health-metric"><span>FAILED</span><b className="mono red">{health.failed}</b></div>
        <div className="export-health-metric"><span>REPAIRED SKIPS</span><b className="mono gold">{health.repairedKnownSkips}</b></div>
        <div className="export-health-metric"><span>TOTAL</span><b className="mono">{health.total}</b></div>
      </div>
      <div className="export-health-foot">
        <div className="export-health-note">
          <span>LAST SUCCESSFUL EXPORT</span>
          <b>{health.lastSuccessfulExport ? formatFreshness(health.lastSuccessfulExport) : 'None in this period'}</b>
          {(health.lastSuccessfulEvent || health.lastSuccessfulLead) ? (
            <small>{health.lastSuccessfulEvent ?? 'Conversion'}{health.lastSuccessfulLead ? ` · ${health.lastSuccessfulLead}` : ''}</small>
          ) : null}
        </div>
        <div className="export-health-note">
          <span>LAST FAILURE REASON</span>
          <b>{health.lastFailureReason ?? 'No failed exports in this period'}</b>
          {health.lastFailureAt ? (
            <small>{formatFreshness(health.lastFailureAt)}{health.lastFailureEvent ? ` · ${health.lastFailureEvent}` : ''}</small>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function captureStatusLabel(status: ClickCaptureHealth['status']): string {
  if (status === 'attention') return 'Needs attention'
  if (status === 'watch') return 'Watch capture'
  return 'Clean'
}

function captureGapSummary(source: ClickCaptureSourceHealth): string {
  if (source.gaps.platformToServer > 0) return `${formatNum(source.gaps.platformToServer)} platform click${source.gaps.platformToServer === 1 ? '' : 's'} without server landing`
  if (source.gaps.serverToBrowser > 0) return `${formatNum(source.gaps.serverToBrowser)} server landing${source.gaps.serverToBrowser === 1 ? '' : 's'} without browser replay`
  if (source.gaps.browserToForm > 0) return `${formatNum(source.gaps.browserToForm)} browser session${source.gaps.browserToForm === 1 ? '' : 's'} did not start the form`
  if (source.gaps.formToLead > 0) return `${formatNum(source.gaps.formToLead)} form start${source.gaps.formToLead === 1 ? '' : 's'} without CRM lead`
  if (source.gaps.leadToExport > 0) return `${formatNum(source.gaps.leadToExport)} lead signal${source.gaps.leadToExport === 1 ? '' : 's'} awaiting sent export`
  return 'No capture gap for this source'
}

function CaptureSourceRow({ source }: { source: ClickCaptureSourceHealth }) {
  const tone = exportHealthTone(source.status)
  return (
    <div className="capture-source-row">
      <div className="capture-source-head">
        <div>
          <b>{source.label}</b>
          <span>{source.message}</span>
        </div>
        <em style={{ color: tone, borderColor: `${tone}50`, background: `${tone}14` }}>{captureStatusLabel(source.status)}</em>
      </div>
      <div className="capture-stage-list">
        {source.stages.map((stage) => (
          <div className="capture-stage" key={stage.key}>
            <span>{stage.label}</span>
            <b className="mono">{formatNum(stage.value)}</b>
            <small>{stage.previousRate == null ? stage.note : `${stage.previousRate}% from previous`}</small>
          </div>
        ))}
      </div>
      <div className="capture-gap-line">
        <span>{captureGapSummary(source)}</span>
        <span>{source.pendingExports} pending exports · {source.failedExports} failed</span>
      </div>
    </div>
  )
}

function ClickCaptureHealthPanel({ health }: { health: ClickCaptureHealth }) {
  const tone = exportHealthTone(health.status)
  const totals = health.totals
  const summary = [
    { label: 'Platform clicks', value: totals.platformClicks, className: 'blue' },
    { label: 'Server landings', value: totals.serverLandings, className: 'green' },
    { label: 'Browser sessions', value: totals.browserSessions, className: 'purple' },
    { label: 'Form starts', value: totals.formStarts, className: 'gold' },
    { label: 'CRM leads', value: totals.crmLeads, className: 'green' },
    { label: 'Exports sent', value: totals.exportedConversions, className: 'red' },
  ]

  return (
    <div className="panel click-capture-panel">
      <div className="panel-head">
        <div>
          <h2>Click Capture Health</h2>
          <div className="cap">Ad platform clicks through CRM lead and conversion export feedback</div>
        </div>
        <span className="export-health-state" style={{ color: tone, borderColor: `${tone}55`, background: `${tone}16` }}>
          {captureStatusLabel(health.status)}
        </span>
      </div>
      <div className="capture-health-banner" style={{ borderColor: `${tone}44`, background: `${tone}12` }}>
        <b>{health.message}</b>
        <small>Checked {health.generatedAt ? formatFreshness(health.generatedAt) : 'waiting'} · {captureGapSummary(totals)}</small>
      </div>
      <div className="capture-health-grid">
        {summary.map((item) => (
          <div className="capture-health-metric" key={item.label}>
            <span>{item.label}</span>
            <b className={`mono ${item.className}`}>{formatNum(item.value)}</b>
          </div>
        ))}
      </div>
      <div className="capture-source-list">
        {health.sources.map((source) => (
          <CaptureSourceRow key={source.source} source={source} />
        ))}
      </div>
    </div>
  )
}

type OutboxLeadGroup = {
  key: string
  leadName: string
  leadId: string | number | null
  campaign: string
  keyword: string
  clickId: string
  clickIdType: string
  latest: OutboxRow
  rows: OutboxRow[]
  eventCount: number
  status: string
  value: number
  attempts: number
  dryRun: boolean
}

function groupOutboxByLead(rows: OutboxRow[]): OutboxLeadGroup[] {
  const groups = new Map<string, OutboxRow[]>()
  for (const row of rows) {
    const key = row.leadId ? `lead:${row.leadId}` : `unlinked:${row.clickId}:${row.campaign}:${row.keyword}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  return Array.from(groups.entries())
    .map(([key, groupRows]) => {
      const ordered = [...groupRows].sort((a, b) => Date.parse(b.eventTime) - Date.parse(a.eventTime))
      const latest = ordered[0]
      const statusValues = ordered.map((row) => row.status.toLowerCase())
      const failed = statusValues.some((status) => /failed|dead/.test(status))
      const awaiting = ordered.some((row) => row.approvalRequired && row.status.toLowerCase().includes('approval'))
      const pending = statusValues.some((status) => status.includes('pending') || status.includes('processing'))
      const sent = statusValues.every((status) => status.includes('sent'))
      const clickRow = ordered.find((row) => row.clickId !== '--') ?? latest

      return {
        key,
        leadName: latest.leadName,
        leadId: latest.leadId,
        campaign: latest.campaign,
        keyword: latest.keyword,
        clickId: clickRow.clickId,
        clickIdType: clickRow.clickIdType,
        latest,
        rows: ordered,
        eventCount: ordered.length,
        status: failed ? 'Failed' : awaiting ? 'Awaiting approval' : pending ? 'Pending' : sent ? 'Sent' : latest.status,
        value: ordered.reduce((sum, row) => sum + row.value, 0),
        attempts: ordered.reduce((sum, row) => sum + row.attempts, 0),
        dryRun: ordered.some((row) => row.dryRun),
      } satisfies OutboxLeadGroup
    })
    .sort((a, b) => Date.parse(b.latest.eventTime) - Date.parse(a.latest.eventTime))
}

function LeadOutboxPanel({
  rows,
  period,
  onPeriodChange,
}: {
  rows: OutboxRow[]
  period: MarketingPeriod
  onPeriodChange: (period: MarketingPeriod) => void
}) {
  const [page, setPage] = useState(0)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const cap = PERIODS[period].days
  const filtered = rows.filter((row) => row.ageDays <= cap)
  const grouped = useMemo(() => groupOutboxByLead(filtered), [filtered])
  const pages = Math.max(1, Math.ceil(grouped.length / OUTBOX_PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const start = safePage * OUTBOX_PAGE_SIZE
  const visibleGroups = grouped.slice(start, start + OUTBOX_PAGE_SIZE)
  const awaiting = filtered.filter((row) => row.approvalRequired && row.status.toLowerCase().includes('approval')).length
  const pending = filtered.filter((row) => ['pending', 'processing'].some((status) => row.status.toLowerCase().includes(status))).length
  const sent = filtered.filter((row) => row.status.toLowerCase().includes('sent')).length
  const failed = filtered.filter((row) => /failed|dead/i.test(row.status)).length

  function toggleGroup(key: string) {
    setOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handlePeriodChange(nextPeriod: MarketingPeriod) {
    setPage(0)
    onPeriodChange(nextPeriod)
  }

  return (
    <div className="panel outbox-panel">
      <div className="panel-head">
        <div>
          <h2>Lead Conversion Outbox</h2>
          <div className="cap">Google Ads offline conversion queue • approval, delivery, and CRM lead linkage</div>
        </div>
        <PeriodSelect value={period} onChange={handlePeriodChange} label="Outbox period" />
      </div>
      <div className="outbox-summary">
        <div><span>LEADS</span><b className="mono">{grouped.length}</b></div>
        <div><span>EVENTS</span><b className="mono">{filtered.length}</b></div>
        <div><span>AWAITING</span><b className="mono gold">{awaiting}</b></div>
        <div><span>PENDING</span><b className="mono blue">{pending}</b></div>
        <div><span>SENT</span><b className="mono green">{sent}</b></div>
        <div><span>FAILED</span><b className="mono red">{failed}</b></div>
      </div>
      <div className="table-scroll">
        <table className="outbox-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Events</th>
              <th>Status</th>
              <th>Click ID</th>
              <th>Value</th>
              <th>Latest</th>
              <th>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.length === 0 ? (
              <tr>
                <td className="empty-table" colSpan={7}>No outbox rows for this period.</td>
              </tr>
            ) : visibleGroups.map((group) => {
              const color = outboxTone({ ...group.latest, status: group.status, dryRun: group.dryRun })
              const open = openGroups.has(group.key)
              return (
                <Fragment key={group.key}>
                  <tr className="outbox-lead-row">
                    <td>
                      <button className="outbox-expand" type="button" onClick={() => toggleGroup(group.key)}>
                        <span>{open ? '-' : '+'}</span>
                        <span>
                          <span className="outbox-lead">{group.leadName}</span>
                          <span className="outbox-sub outbox-source-line">
                            <span className="source-tag">{group.latest.source ?? 'Google Ads'}</span>
                            <span>{group.campaign} · {group.keyword}</span>
                          </span>
                        </span>
                      </button>
                    </td>
                    <td><span className="mono">{group.eventCount}</span><span className="outbox-sub">related events</span></td>
                    <td>
                      <span className="outbox-status" style={{ color, borderColor: `${color}55`, background: `${color}16` }}>
                        {group.dryRun ? 'Dry run' : group.status}
                      </span>
                    </td>
                    <td><span className="mono">{group.clickId}</span><span className="outbox-sub">{group.clickIdType}</span></td>
                    <td className="mono">{group.value ? formatUsd(group.value) : '--'}</td>
                    <td>{outboxTime(group.latest)}</td>
                    <td><span className="mono">{group.attempts}</span></td>
                  </tr>
                  {open ? (
                    <tr className="outbox-detail-row">
                      <td colSpan={7}>
                        <div className="outbox-events">
                          {group.rows.map((row) => {
                            const eventColor = outboxTone(row)
                            return (
                              <div className="outbox-event-line" key={row.id}>
                                <div>
                                  <span className="outbox-event">{row.event}</span>
                                  <span className="outbox-sub outbox-source-line">
                                    <span className="source-tag">{row.source ?? 'Google Ads'}</span>
                                    <span>{row.exportNote || `${row.category} · ${row.role}`}</span>
                                  </span>
                                </div>
                                <span className="outbox-status" style={{ color: eventColor, borderColor: `${eventColor}55`, background: `${eventColor}16` }}>
                                  {row.dryRun ? 'Dry run' : row.status}
                                </span>
                                <span className="mono">{row.clickId}<small>{row.clickIdType}</small></span>
                                <span className="mono">{row.value ? formatUsd(row.value) : '--'}</span>
                                <span>{outboxTime(row)}</span>
                                <span className="mono">{row.attempts}</span>
                                {row.lastError ? <span className="outbox-error">{row.lastError}</span> : null}
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {grouped.length > OUTBOX_PAGE_SIZE ? (
        <div className="keyword-pager">
          <span>{`${start + 1}-${Math.min(start + OUTBOX_PAGE_SIZE, grouped.length)} of ${grouped.length} leads`}</span>
          <div className="keyword-pager-actions">
            <button className="pager-btn" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)} type="button">←</button>
            <button className="pager-btn" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} type="button">→</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function LatestPaidJourneys({
  sessions,
  platformClicks,
  filter,
  range,
  limit,
  page,
  onFilterChange,
  onRangeChange,
  onLimitChange,
  onPageChange,
  onOpenSession,
}: {
  sessions: PaidSessionRow[]
  platformClicks: number
  filter: PaidFilter
  range: PaidRange
  limit: number
  page: number
  onFilterChange: (filter: PaidFilter) => void
  onRangeChange: (range: PaidRange) => void
  onLimitChange: (limit: number) => void
  onPageChange: (page: number) => void
  onOpenSession: (session: PaidSessionRow) => void
}) {
  const filtered = useMemo(() => {
    return sessions.filter((session) => {
      if (filter === 'lead' && !session.converted) return false
      if (filter === 'nolead' && session.converted) return false
      if (range === 'all') return true
      if (range === 'today') return session.date === 'today'
      if (range === 'yesterday') return session.date === 'yesterday'
      return true
    })
  }, [filter, range, sessions])
  const pages = Math.max(1, Math.ceil(filtered.length / limit))
  const safePage = Math.min(page, pages - 1)
  const start = safePage * limit
  const rows = filtered.slice(start, start + limit)
  const clicks = filtered.length
  const conversions = filtered.filter((session) => session.converted).length
  const paidClicks = paidClickCount(platformClicks, clicks)
  const unmatchedClicks = platformClicks > 0 ? Math.max(0, platformClicks - clicks) : 0
  const extraTrackedSessions = platformClicks > 0 ? Math.max(0, clicks - platformClicks) : 0
  const cr = paidClicks ? (conversions / paidClicks) * 100 : 0

  useEffect(() => {
    if (page !== safePage) onPageChange(safePage)
  }, [onPageChange, page, safePage])

  return (
    <div className="panel">
      <div className="sec-title">
        <h2>Latest Google Ads Journeys</h2>
        <span className="cap">Search click attribution with available first-party session replay</span>
      </div>
      <div className="pj-metrics">
        <div className="pjm green"><div className="l">CONVERSION RATE</div><div className="v">{cr.toFixed(1)}%</div></div>
        <div className="pjm blue"><div className="l">GOOGLE ADS CLICKS</div><div className="v">{paidClicks}</div></div>
        <div className="pjm purple"><div className="l">SESSION REPLAYS</div><div className="v">{clicks}</div></div>
        <div className="pjm red"><div className="l">CONVERSIONS</div><div className="v">{conversions}</div></div>
      </div>
      {unmatchedClicks > 0 ? (
        <div className="pj-gap">
          <b>{formatNum(unmatchedClicks)} Google Ads click{unmatchedClicks === 1 ? '' : 's'} imported without a replayable website session.</b>
          <span>Journey rows appear after the landing page sends a tracking event. The visitor may have bounced before load, blocked tracking, or arrived without a Google click ID.</span>
        </div>
      ) : extraTrackedSessions > 0 ? (
        <div className="pj-gap">
          <b>{formatNum(extraTrackedSessions)} replayable Google Ads session{extraTrackedSessions === 1 ? '' : 's'} exceed imported platform clicks.</b>
          <span>The click total stays aligned to Google Ads. Extra sessions are first-party attribution signals and may include refreshes, previews, or browser sessions Google did not count as billable clicks.</span>
        </div>
      ) : null}
      <div className="pj-controls">
        <div className="pj-tabs">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => onFilterChange('all')} type="button">All</button>
          <button className={filter === 'lead' ? 'on' : ''} onClick={() => onFilterChange('lead')} type="button">Converted</button>
          <button className={filter === 'nolead' ? 'on' : ''} onClick={() => onFilterChange('nolead')} type="button">No Lead</button>
        </div>
        <select className="gsel" aria-label="Google Ads journey range" value={range} onChange={(event) => onRangeChange(event.target.value as PaidRange)}>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">This Week</option>
          <option value="month">Last 30 Days</option>
          <option value="qtr">Qtr</option>
          <option value="ytd">YTD</option>
        </select>
        <select className="gsel" aria-label="Google Ads journey rows" value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}>
          <option value="5">5 rows</option>
          <option value="10">10 rows</option>
          <option value="25">25 rows</option>
        </select>
        <div className="pager">
          <span>{filtered.length ? `${start + 1}–${Math.min(start + limit, filtered.length)} of ${filtered.length}` : '0 results'}</span>
          <button className="pager-btn" disabled={safePage <= 0} onClick={() => onPageChange(safePage - 1)} type="button">←</button>
          <button className="pager-btn" disabled={safePage >= pages - 1} onClick={() => onPageChange(safePage + 1)} type="button">→</button>
        </div>
      </div>
      <div className="paid-list">
        {rows.length === 0 ? (
          <div className="pj-empty">
            <b>No replayable sessions for this filter yet.</b>
            <span>{platformClicks > 0 ? `${formatNum(platformClicks)} Google Ads click${platformClicks === 1 ? '' : 's'} imported, but no matching on-site journey is available for this period.` : 'Google Ads clicks and on-site journeys will appear here after Search traffic reaches the landing page.'}</span>
          </div>
        ) : rows.map((session) => {
          const progress = microProgress(session.progress)
          const currentStep = microStepName(session, progress - 1)
          return (
            <button className="paid-row" key={session.id} onClick={() => onOpenSession(session)} type="button">
              <span className="paid-time">{session.time}<small>{session.dateL}</small></span>
              <span>
                <span className="paid-camp"><span className="source-tag">{session.source ?? 'Google Ads'}</span> {session.campaign} <span className="gclid">{session.gclid.slice(0, 10)}…</span></span>
                <span className="paid-meta">
                  <span><b>{progress}/{MICRO_STEPS.length}</b> steps</span>
                  <span>{currentStep}</span>
                  <span>{session.sub}</span>
                  <span>{session.city}</span>
                </span>
                <span className="paid-bar">
                  {MICRO_STEPS.map((_, index) => {
                    const n = index + 1
                    const cls = n < progress
                      ? 'done'
                      : n === progress
                        ? session.converted ? 'done' : 'current'
                        : n === progress + 1 && !session.converted
                          ? 'miss'
                          : ''
                    return <span key={index} className={`paid-seg ${cls}`} />
                  })}
                </span>
              </span>
              <span className={`paid-status ${session.converted ? 'lead' : 'nolead'}`}>{session.converted ? '✓ Lead Created' : '— No Lead'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function buildJourney(lead: LeadRow) {
  const source = lead.source ?? 'Google Ads'
  return [
    { h: 'Ad Impression', d: `Served by ${source} on "${lead.kw}" · ${lead.campaign}` },
    { h: 'Keyword Click', d: `Clicked search ad → routed to ${lead.land}` },
    { h: 'Landing Page', d: `Viewed savingkc.com${lead.land} · source=${source}` },
    { h: 'Conversion Fired', d: `${lead.land === '/guide' ? 'Guide download' : 'Call form submit'} · logged to conversion outbox` },
    { h: 'New Lead Created', d: `Entered pipeline · SmartSkip enrichment · ${lead.county}` },
    { h: 'Attempted Contact', d: `Casey: ${lead.dials} dial${lead.dials === 1 ? '' : 's'} via Twilio` },
    { h: 'Connected', d: `${lead.connects} live connect${lead.connects === 1 ? '' : 's'} · ${lead.talk} min talk time` },
    { h: 'Opportunity', d: `Motivation confirmed · scored ${lead.score} (${lead.verdict})` },
    { h: 'Appointment Set', d: `Walkthrough scheduled · ${lead.prop}` },
    { h: 'Offer Made', d: `Offer presented · projected spread ${formatUsd(lead.spread)}` },
    { h: 'Under Contract', d: 'Signed via DocuSeal · spread locked' },
    { h: 'Closed / Assigned', d: 'Assigned to buyer · spread realized' },
  ]
}

function JourneyOverlay({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const color = scoreColor(lead.verdict)
  const journey = buildJourney(lead)
  const totalXP = XP.slice(0, lead.progress + 1).reduce((sum, value) => sum + value, 0)
  const ringDash = 2 * Math.PI * 20
  const offset = ringDash * (1 - lead.score / 100)

  return (
    <div className="overlay open" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="stage">
        <div className="stage-top">
          <button className="back" onClick={onClose} type="button">← Back to Google Ads</button>
          <div>
            <div className="eyebrow">LEAD JOURNEY</div>
            <div className="qname">{lead.name}</div>
          </div>
          <div className="qbadges">
            <span className="qb">{lead.county}</span>
            <span className="qb">{lead.prop}</span>
            <span className="qb" style={{ borderColor: color, color }}>{lead.verdict}</span>
          </div>
        </div>
        <div className="stage-body">
          <div className="map">
            <div className="maptitle">JOURNEY MAP • IMPRESSION → CLOSED</div>
            <div className="board">
              {STAGES.map((stage, index) => {
                const done = index < lead.progress
                const current = index === lead.progress
                return (
                  <div className={`node ${current ? 'current' : done ? 'done' : 'locked'}`} key={stage.key}>
                    <div className="conn" />
                    <div className="orb">
                      <SvgIcon name={stage.icon} size={22} />
                      {done || current ? <span className="xp-tag">+{XP[index]}</span> : null}
                    </div>
                    <div className="nlabel">{stage.name}</div>
                    <div className="nmeta">{done ? '✓ cleared' : current ? '◉ active' : 'locked'}</div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="statside">
            <div className="charcard">
              <div className="campaign-label">{lead.source ?? 'Google Ads'} · {lead.campaign}</div>
              <div className="char-name">{lead.name}</div>
              <div className="char-meta">{lead.prop}<br />{lead.county}<br />{lead.days} days in pipeline</div>
              <div className="score-row">
                <div className="score-ring">
                  <svg width="56" height="56">
                    <circle cx="28" cy="28" r="20" stroke="var(--line)" strokeWidth="6" fill="none" />
                    <circle
                      cx="28"
                      cy="28"
                      r="20"
                      stroke={color}
                      strokeWidth="6"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={ringDash}
                      strokeDashoffset={offset}
                    />
                  </svg>
                  <div style={{ color }}>{lead.score}</div>
                </div>
                <div><div className="verdict" style={{ color }}>{lead.verdict}</div><div className="score-caption">FAVORITE-OR-FOOL</div></div>
              </div>
            </div>
            <div className="statgrid">
              <div className="stat"><div className="sl">PROJ. SPREAD</div><div className="ss mono green">{formatUsd(lead.spread)}</div></div>
              <div className="stat"><div className="sl">AD COST</div><div className="ss mono">{formatUsd(lead.spend)}</div></div>
              <div className="stat"><div className="sl">DIALS</div><div className="ss mono">{lead.dials}</div></div>
              <div className="stat"><div className="sl">CONNECTS</div><div className="ss mono blue">{lead.connects}</div></div>
              <div className="stat"><div className="sl">TALK TIME</div><div className="ss mono">{lead.talk}m</div></div>
              <div className="stat"><div className="sl">JOURNEY XP</div><div className="ss mono gold">{totalXP}</div></div>
            </div>
            <div className="journey-log">
              {journey.slice(0, Math.min(lead.progress + 1, journey.length)).map((item, index) => (
                <div className="log-item" key={`${item.h}-${index}`}>
                  <div className="step-id">STEP {String(index + 1).padStart(2, '0')}</div>
                  <div className="log-title">{item.h}</div>
                  <div className="log-detail">{item.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function buildMicroEvents(session: PaidSessionRow) {
  const sub = session.sub
  const source = session.source ?? 'Google Ads'
  const timeline = session.timeline || 'Not captured'
  const condition = session.condition || 'Not captured'
  const fields = session.contactFields?.length ? session.contactFields.map(displayFieldName).join(', ') : 'not captured'
  const isTax = isTaxStylePaidLanding(session.land) || Boolean(session.auctionStatus)
  const engagement = session.scrollDepth && session.scrollDepth > 0
    ? `Scrolled ${session.scrollDepth}%`
    : 'Page engagement tracked'

  return [
    { ts: '0:00', dur: 0, durLabel: 'instant', act: `Clicked ${source} ad · keyword <b>"${session.kw}"</b>` },
    { ts: '0:00', dur: session.loadMs / 1000, durLabel: `${(session.loadMs / 1000).toFixed(1)}s LCP`, act: `Loaded savingkc.com${session.land} · ${session.device}` },
    { ts: '0:04', dur: 0, durLabel: 'tracked', act: engagement },
    { ts: '0:23', dur: 12, durLabel: '12s', act: `Opened situation dropdown · <b>${sub}</b>` },
    {
      ts: '0:35',
      dur: 0,
      durLabel: 'tracked',
      act: isTax
        ? `Auction status: <b>${session.auctionStatus || 'Not captured'}</b>`
        : `Timeline: <b>${timeline}</b>`,
    },
    {
      ts: '0:44',
      dur: 0,
      durLabel: 'tracked',
      act: isTax
        ? `Timeline: <b>${timeline}</b> · Condition: <b>${condition}</b>`
        : `Condition: <b>${condition}</b>`,
    },
    { ts: '0:51', dur: 0, durLabel: 'tracked', act: `Contact form reached · fields: <b>${fields}</b>` },
    { ts: '1:32', dur: 0, durLabel: 'instant', act: 'Form submitted · conversion fired' },
  ]
}

function displayFieldName(field: string): string {
  if (field === 'address') return 'address'
  if (field === 'name') return 'name'
  if (field === 'phone') return 'phone'
  if (field === 'email') return 'email'
  return field.replace(/[_-]+/g, ' ')
}

function microStepName(session: PaidSessionRow, index: number): string {
  const step = MICRO_STEPS[index]
  if (!step) return '—'
  const isTax = isTaxStylePaidLanding(session.land) || Boolean(session.auctionStatus)
  if (isTax && step.key === 'timeline') return 'Auction Status'
  if (isTax && step.key === 'condition') return 'Timeline + Condition'
  return step.name
}

function isTaxStylePaidLanding(path: string): boolean {
  return (
    path.startsWith('/ppc-tax') ||
    path.startsWith('/ppc-redemption') ||
    path.startsWith('/ppc-excess-proceeds')
  )
}

function microProgress(progress: number): number {
  return Math.min(MICRO_STEPS.length, Math.max(1, progress))
}

function fallbackSessionDuration(events: ReturnType<typeof buildMicroEvents>, progress: number): number {
  const last = events[progress - 1]
  if (!last) return 0
  const [minutes = 0, seconds = 0] = last.ts.split(':').map(Number)
  return (minutes * 60) + seconds + (last.dur || 0)
}

function MicroReplayOverlay({
  session,
  leads,
  onClose,
  onOpenLead,
}: {
  session: PaidSessionRow
  leads: LeadRow[]
  onClose: () => void
  onOpenLead: (lead: LeadRow) => void
}) {
  const color = session.converted ? '#22c55e' : '#f87171'
  const events = buildMicroEvents(session)
  const progress = microProgress(session.progress)
  const totalSec = session.durationSec ?? fallbackSessionDuration(events, progress)
  const mins = Math.floor(totalSec / 60)
  const secs = Math.round(totalSec % 60)
  const pageDepth = session.scrollDepth ?? 0
  const drop = session.drop ? DROP_LABEL[session.drop] : null
  const lead = session.leadId ? leads.find((item) => String(item.id) === String(session.leadId)) : null
  const currentStepName = microStepName(session, progress - 1)

  return (
    <div className="overlay open" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="stage">
        <div className="stage-top">
          <button className="back" onClick={onClose} type="button">← Back to Google Ads</button>
          <div>
            <div className="eyebrow">SESSION REPLAY</div>
            <div className="qname">{session.campaign} · {session.gclid.slice(0, 14)}…</div>
          </div>
          <div className="qbadges">
            <span className="qb">{session.dateL}, {session.time}</span>
            <span className="qb">{session.sub}</span>
            <span className="qb" style={{ borderColor: color, color }}>{session.converted ? '✓ Converted' : '✕ No Lead'}</span>
          </div>
        </div>
        <div className="micro-body">
          <div className="micro-main">
            <div className="micro-summary">
              <div className="ms"><div className="l">SESSION</div><div className="v">{mins}<small>m</small> {secs}<small>s</small></div></div>
              <div className="ms"><div className="l">DEPTH</div><div className="v">{pageDepth}<small>%</small></div></div>
              <div className="ms" style={{ borderColor: color }}><div className="l">STEPS</div><div className="v">{progress}<small>/{MICRO_STEPS.length}</small></div></div>
              <div className="ms" style={{ borderColor: color }}><div className="l">{session.converted ? 'OUTCOME' : 'DROPOFF'}</div><div className="v small">{session.converted ? 'Submitted' : currentStepName}</div></div>
            </div>
            <div className="timeline-title">MICRO-EVENT TIMELINE</div>
            <div className="micro-timeline">
              {MICRO_STEPS.map((step, index) => {
                const n = index + 1
                const done = n < progress || (n === progress && session.converted)
                const current = n === progress && !session.converted
                const miss = n > progress
                const event = events[index]
                return (
                  <div key={step.key}>
                    <div className={`me ${miss ? 'miss' : done ? 'done' : current ? 'current' : ''}`}>
                      <div className="icon"><SvgIcon name={step.icon} size={14} /></div>
                      <div className="lab">{n}. {microStepName(session, index)}{miss ? ' · not reached' : ''}</div>
                      {!miss ? (
                        <div className="event-act" dangerouslySetInnerHTML={{ __html: event.act }} />
                      ) : (
                        <div className="event-act muted">Lead never reached this step</div>
                      )}
                      {!miss && event.dur > 0 ? (
                        <div className="dwell"><span style={{ width: `${Math.min(100, event.dur * 3.5)}%` }} /></div>
                      ) : null}
                    </div>
                    {!session.converted && n === progress && drop ? (
                      <div className="drop-node">
                        <div className="drop-title">⚠ {drop.h}</div>
                        <div className="drop-detail">{drop.d}</div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="micro-side">
            <div className="side-label">CAMPAIGN</div>
            <div className="side-copy">{session.source ?? 'Google Ads'}<br />{session.campaign}<br />{session.sub}<br /><span className="mono">{session.kw}</span></div>
            <div className="side-label spaced">LANDING</div>
            <div className="side-copy mono">savingkc.com{session.land}<br />{(session.loadMs / 1000).toFixed(2)}s LCP</div>
            {session.converted ? (
              <div className="side-cta converted">
                <div>Lead created in CRM</div>
                {lead ? <button type="button" onClick={() => { onClose(); setTimeout(() => onOpenLead(lead), 180) }}>Continue to full journey →</button> : null}
              </div>
            ) : (
              <div className="side-cta nolead">
                <div>No conversion</div>
                <div className="side-buttons">
                  <button
                    type="button"
                    disabled
                    title="Retargeting is unavailable until the Google Ads journey workflow is configured"
                  >
                    + Retarget
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Flagging is unavailable until the review workflow is configured"
                  >
                    Flag
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function BreakdownOverlay({ breakdown, onClose }: { breakdown: MarketingBreakdown; onClose: () => void }) {
  const itemTotal = breakdownTotal(breakdown.items)
  const displayTotal = breakdown.total || itemTotal

  return (
    <div className="overlay open" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="breakdown-modal">
        <div className="stage-top">
          <button className="back" onClick={onClose} type="button">Close</button>
          <div>
            <div className="eyebrow">BREAKDOWN</div>
            <div className="qname">{breakdown.title}</div>
          </div>
          <div className="qbadges">
            <span className="qb">{breakdown.subtitle}</span>
            <span className="qb">{displayTotal.toLocaleString()} {breakdown.metricLabel}</span>
          </div>
        </div>
        <div className="breakdown-body">
          <div className="breakdown-total">
            <span>Total</span>
            <strong className="mono">{displayTotal.toLocaleString()}</strong>
            <em>{breakdown.metricLabel}</em>
          </div>
          <div className="breakdown-list">
            {breakdown.items.map((item) => {
              const pct = shareOf(item.value, itemTotal)
              return (
                <div className="breakdown-item" key={item.label}>
                  <div className="breakdown-line">
                    <span><i style={{ background: item.color }} />{item.label}</span>
                    <b className="mono">{item.value.toLocaleString()} {breakdown.metricLabel} · {pct}%</b>
                  </div>
                  <div className="breakdown-bar">
                    <span style={{ width: `${pct}%`, background: item.color }} />
                  </div>
                  {item.note ? <p>{item.note}</p> : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function LandingHeatmapLauncher() {
  const tracked = [
    'FAQs opened',
    'CTA clicks',
    'Show Me clicks',
    'Video watch depth',
    'Section attention',
    'Generic payload gaps',
  ]

  return (
    <div className="heatmap-launch panel">
      <div className="heatmap-copy">
        <span className="mini-eyebrow">GOOGLE ADS LANDING PAGES</span>
        <h2>See how Search visitors use each landing page.</h2>
        <p>
          Inspect Google Ads and Google Ads Tax behavior by section, CTA, FAQ, video, session, and attributed lead.
        </p>
        <div className="heatmap-track-list">
          {tracked.map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
      <Link className="heatmap-open" href="/marketing/heatmaps?source=google_ads">
        Open Google Ads Heatmaps
      </Link>
    </div>
  )
}

function trafficQualityLabel(status: TrafficQualityStatus): string {
  if (status === 'suspicious') return 'Suspicious'
  if (status === 'watch') return 'Watch'
  return 'Healthy'
}

function trafficQualityTone(status: TrafficQualityStatus): 'good' | 'watch' | 'bad' {
  if (status === 'suspicious') return 'bad'
  if (status === 'watch') return 'watch'
  return 'good'
}

function compactTrafficValue(value: string | null | undefined, keep = 20): string {
  if (!value || value === '--') return '--'
  return value.length > keep ? `${value.slice(0, keep)}...` : value
}

function trafficDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder.toString().padStart(2, '0')}s`
}

function TrafficQualityPanel({ report }: { report: TrafficQualityReport }) {
  const tone = trafficQualityTone(report.status)
  const summary = report.summary
  const stats = [
    { label: 'Sessions scored', value: summary.sessions, sub: `${summary.cleanSessions} clean` },
    { label: 'Watch / suspicious', value: summary.watchSessions + summary.suspiciousSessions, sub: `${summary.suspiciousRate}% of traffic` },
    { label: 'Server landings', value: summary.serverLandingRequests, sub: `${summary.serverOnlySessions} server-only` },
    { label: 'No engagement', value: summary.noEngagementSessions, sub: `${summary.shortVisitSessions} very short` },
    { label: 'Repeat clusters', value: summary.repeatIpClusters + summary.repeatUaClusters, sub: `${summary.repeatIpClusters} IP / ${summary.repeatUaClusters} browser` },
    { label: 'Bot sessions', value: summary.botSessions, sub: 'classified by request context' },
  ]

  return (
    <div className={`traffic-quality panel tq-${tone}`}>
      <div className="traffic-hero">
        <div className="traffic-copy">
          <span className="mini-eyebrow">TRAFFIC QUALITY</span>
          <h2>Google Ads click monitoring without automatic blocking.</h2>
          <p>
            Every Google Ads landing request is captured before browser JavaScript, then matched against engagement events, click IDs, hashed IP/browser patterns, and CRM outcomes.
          </p>
        </div>
        <div className="traffic-score">
          <span>Quality Score</span>
          <strong className="mono">{report.score}</strong>
          <em>{trafficQualityLabel(report.status)}</em>
        </div>
      </div>

      <div className="traffic-cadence" aria-label="Traffic quality run cadence">
        <div><b>Capture</b><span>{report.runSchedule.capture}</span></div>
        <div><b>Analysis</b><span>{report.runSchedule.analysis}</span></div>
        <div><b>Mode</b><span>{report.runSchedule.mode}</span></div>
        <div><b>Checked</b><span>{formatFreshness(report.lastEvaluatedAt)}</span></div>
      </div>

      <div className="traffic-stats">
        {stats.map((item) => (
          <div className="traffic-stat" key={item.label}>
            <span>{item.label}</span>
            <strong className="mono">{formatNum(item.value)}</strong>
            <em>{item.sub}</em>
          </div>
        ))}
      </div>

      <div className="traffic-grid">
        <div className="traffic-issues">
          <div className="traffic-section-head">
            <h3>Issues to review</h3>
            <span>{report.issues.length ? `${report.issues.length} active` : 'None active'}</span>
          </div>
          {report.issues.length ? report.issues.map((item) => (
            <div className={`traffic-issue ${item.severity}`} key={item.key}>
              <div>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
              </div>
              <b className="mono">{formatNum(item.count)}</b>
            </div>
          )) : (
            <div className="traffic-empty">No repeat-click or bot-pattern issues in the selected period.</div>
          )}
        </div>

        <div className="traffic-sources">
          <div className="traffic-section-head">
            <h3>Source pressure</h3>
            <span>{report.sources.length ? 'By campaign' : 'Waiting'}</span>
          </div>
          {report.sources.length ? report.sources.map((source) => (
            <div className="traffic-source-row" key={source.key}>
              <div>
                <strong>{source.label.replace(/^google_ads\s*\/\s*/i, '')}</strong>
                <span>{source.sessions} sessions · {source.noEngagement} no engagement · {source.serverOnly} server-only</span>
              </div>
              <b className="mono">{source.suspiciousRate}%</b>
            </div>
          )) : (
            <div className="traffic-empty">No Google Ads traffic rows yet for this period.</div>
          )}
        </div>
      </div>

      <div className="traffic-table-wrap">
        <div className="traffic-section-head">
          <h3>Highest-risk sessions</h3>
          <span>Hashed device signals only</span>
        </div>
        <div className="table-scroll">
          <table className="traffic-table">
            <thead>
              <tr>
                <th>Risk</th>
                <th>Campaign</th>
                <th>Click / Session</th>
                <th>Flags</th>
                <th>Device</th>
                <th>Duration</th>
                <th>Form</th>
              </tr>
            </thead>
            <tbody>
              {report.sessions.length ? report.sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <span className={`traffic-risk ${trafficQualityTone(session.status)}`}>
                      {session.riskScore}
                    </span>
                  </td>
                  <td className="kw">
                    {session.campaign}
                    <span className="traffic-muted">Google Ads · {session.landingPage}</span>
                  </td>
                  <td className="mono">
                    {compactTrafficValue(session.clickId, 18)}
                    <span className="traffic-muted">IP {session.ipHashPrefix ?? '--'} · UA {session.userAgentHashPrefix ?? '--'}</span>
                  </td>
                  <td className="traffic-flags">
                    {session.flags.slice(0, 3).map((flag) => <span key={flag}>{flag}</span>)}
                  </td>
                  <td>{session.device}</td>
                  <td className="mono">{trafficDuration(session.durationSec)}</td>
                  <td className="mono">Step {session.maxFormStep} · {session.maxScrollDepth}%</td>
                </tr>
              )) : (
                <tr>
                  <td className="empty-table" colSpan={7}>No Google Ads sessions to score yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function LayoutSection({
  id,
  collapsed,
  isDragging,
  children,
  onToggleCollapsed,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onPointerStart,
  onPointerMove,
  onPointerEnd,
}: {
  id: DashboardSectionId
  collapsed: boolean
  isDragging: boolean
  children: ReactNode
  onToggleCollapsed: (id: DashboardSectionId) => void
  onDragStart: (id: DashboardSectionId, event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (id: DashboardSectionId, event: DragEvent<HTMLElement>) => void
  onPointerStart: (id: DashboardSectionId, event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerEnd: () => void
}) {
  const section = DASHBOARD_SECTIONS[id]

  return (
    <section
      className={`layout-section ${section.size} ${collapsed ? 'is-collapsed' : ''} ${isDragging ? 'is-dragging' : ''}`}
      aria-label={section.label}
      data-section-id={id}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(id, event)}
    >
      <div className="layout-head">
        <div className="layout-title">
          <button
            type="button"
            className="layout-drag"
            draggable
            aria-label={`Move ${section.label}`}
            title={`Move ${section.label}`}
            onDragStart={(event) => onDragStart(id, event)}
            onDragEnd={onDragEnd}
            onPointerDown={(event) => onPointerStart(id, event)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            ⇅
          </button>
          <span>{section.label}</span>
        </div>
        <button
          type="button"
          className="layout-toggle"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${section.label}`}
          title={`${collapsed ? 'Expand' : 'Collapse'} ${section.label}`}
          onClick={() => onToggleCollapsed(id)}
        >
          {collapsed ? '+' : '−'}
        </button>
      </div>
      {collapsed ? <div className="layout-collapsed">Collapsed</div> : <div className="layout-body">{children}</div>}
    </section>
  )
}

export function AdsCommandPage() {
  const [periodState, setPeriodState] = useState<PeriodState>({ trend: 'month', funnel: 'month', camp: 'month', kw: 'month', roster: 'month', outbox: 'month' })
  const hasHydrated = useSyncExternalStore(subscribeHydration, clientHydrationSnapshot, serverHydrationSnapshot)
  const [adsData, setAdsData] = useState<AdsCommandData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [activeSeries, setActiveSeries] = useState<MetricKey[]>(['spend', 'leads'])
  const [campView, setCampView] = useState<CampaignView>('campaign')
  const [kwTab, setKwTab] = useState<KeywordTab>('terms')
  const [kwCampaign, setKwCampaign] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('leads')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [pjFilter, setPjFilter] = useState<PaidFilter>('all')
  const [pjRange, setPjRange] = useState<PaidRange>('month')
  const [pjLimit, setPjLimit] = useState(10)
  const [pjPage, setPjPage] = useState(0)
  const [selectedLead, setSelectedLead] = useState<LeadRow | null>(null)
  const [selectedSession, setSelectedSession] = useState<PaidSessionRow | null>(null)
  const [selectedBreakdown, setSelectedBreakdown] = useState<MarketingBreakdown | null>(null)
  const [sectionOrder, setSectionOrder] = useState<DashboardSectionId[]>(DEFAULT_SECTION_ORDER)
  const [collapsedSections, setCollapsedSections] = useState<Record<DashboardSectionId, boolean>>(DEFAULT_COLLAPSED_SECTIONS)
  const [layoutPrefsLoaded, setLayoutPrefsLoaded] = useState(false)
  const [draggingSection, setDraggingSection] = useState<DashboardSectionId | null>(null)
  const draggingSectionRef = useRef<DashboardSectionId | null>(null)
  const kpi = adsData?.kpi ?? []
  const series = adsData?.series ?? []
  const campaigns = adsData?.campaigns ?? EMPTY_CAMPAIGNS
  const keywords = adsData?.keywords ?? []
  const negatives = adsData?.negatives ?? []
  const funnel = adsData?.funnel ?? []
  const callBreakdown = adsData?.callBreakdown ?? []
  const exportHealth = adsData?.exportHealth ?? EMPTY_EXPORT_HEALTH
  const leads = adsData?.leads ?? []
  const outbox = adsData?.outbox ?? []
  const paidSessions = adsData?.paidSessions ?? []
  const captureHealth = useMemo(() => {
    const health = adsData?.captureHealth ?? EMPTY_CLICK_CAPTURE_HEALTH
    return { ...health, sources: health.sources.filter((source) => source.source === 'google_ads') }
  }, [adsData])
  const trafficQuality = adsData?.trafficQuality ?? EMPTY_TRAFFIC_QUALITY_REPORT
  const campaignOptions = useMemo(() => campaigns.map((campaign) => campaign.name), [campaigns])
  const reportingPeriod = periodState.trend

  useEffect(() => {
    try {
      const savedOrder = window.localStorage.getItem(SECTION_ORDER_STORAGE_KEY)
      if (savedOrder) setSectionOrder(normalizeSectionOrder(JSON.parse(savedOrder)))

      const savedCollapsed = window.localStorage.getItem(SECTION_COLLAPSE_STORAGE_KEY)
      if (savedCollapsed) setCollapsedSections(collapsedSectionsFromStorage(JSON.parse(savedCollapsed)))
    } catch (error) {
      console.warn('[ads-command] layout preferences could not be loaded', error)
    } finally {
      setLayoutPrefsLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!layoutPrefsLoaded) return
    window.localStorage.setItem(SECTION_ORDER_STORAGE_KEY, JSON.stringify(sectionOrder))
  }, [layoutPrefsLoaded, sectionOrder])

  useEffect(() => {
    if (!layoutPrefsLoaded) return
    window.localStorage.setItem(SECTION_COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedSectionIds(collapsedSections)))
  }, [collapsedSections, layoutPrefsLoaded])

  useEffect(() => {
    let controller: AbortController | null = null
    let cancelled = false

    async function loadAdsData() {
      controller?.abort()
      controller = new AbortController()
      const params = new URLSearchParams({ period: reportingPeriod, src: 'g' })
      const previewToken = new URLSearchParams(window.location.search).get('adsPreviewToken')
      if (previewToken) params.set('previewToken', previewToken)

      try {
        const response = await fetch(`/read-model?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(`Google Ads read model returned ${response.status}`)
        const data = await response.json() as AdsCommandData
        if (data.paidSourceFilter !== 'google_ads') throw new Error('Google Ads read model returned a mixed source response')
        if (!cancelled) {
          setAdsData(data)
          setLoadError(null)
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.warn('[google-ads] live reporting data unavailable')
          if (!cancelled) setLoadError('Google Ads reporting data could not be loaded. No substitute or sample data is being shown.')
        }
      }
    }

    function refreshWhenActive() {
      if (document.visibilityState === 'visible') void loadAdsData()
    }

    void loadAdsData()
    window.addEventListener('focus', refreshWhenActive)
    document.addEventListener('visibilitychange', refreshWhenActive)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshWhenActive)
      document.removeEventListener('visibilitychange', refreshWhenActive)
      controller?.abort()
    }
  }, [reloadVersion, reportingPeriod])

  useEffect(() => {
    const hasOverlay = Boolean(selectedLead || selectedSession || selectedBreakdown)
    document.body.style.overflow = hasOverlay ? 'hidden' : ''
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedLead(null)
        setSelectedSession(null)
        setSelectedBreakdown(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
    }
  }, [selectedBreakdown, selectedLead, selectedSession])

  function setPanelPeriod(_key: keyof PeriodState, period: MarketingPeriod) {
    setPeriodState({ trend: period, funnel: period, camp: period, kw: period, roster: period, outbox: period })
    setPjRange(period)
    setPjPage(0)
  }

  function setPaidJourneyRange(range: PaidRange) {
    if (range === 'all') return
    setPanelPeriod('trend', range)
  }

  function toggleSeries(metric: MetricKey) {
    setActiveSeries((current) => {
      if (current.includes(metric)) return current.length > 1 ? current.filter((item) => item !== metric) : current
      if (current.length >= 3) return current
      return [...current, metric]
    })
  }

  function handleSort(key: SortKey) {
    setSortKey((current) => {
      if (current === key) {
        setSortDir((dir) => (dir === 'desc' ? 'asc' : 'desc'))
        return current
      }
      setSortDir('desc')
      return key
    })
  }

  function toggleSectionCollapsed(id: DashboardSectionId) {
    setCollapsedSections((current) => ({ ...current, [id]: !current[id] }))
  }

  function handleSectionDragStart(id: DashboardSectionId, event: DragEvent<HTMLElement>) {
    draggingSectionRef.current = id
    setDraggingSection(id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  function handleSectionDragEnd() {
    draggingSectionRef.current = null
    setDraggingSection(null)
  }

  function handleSectionDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function handleSectionDrop(target: DashboardSectionId, event: DragEvent<HTMLElement>) {
    event.preventDefault()
    const source = event.dataTransfer.getData('text/plain') || draggingSection
    if (!source || !isDashboardSectionId(source)) {
      setDraggingSection(null)
      return
    }

    const targetRect = event.currentTarget.getBoundingClientRect()
    const placeAfter = event.clientY > targetRect.top + targetRect.height / 2
    setSectionOrder((current) => moveSection(current, source, target, placeAfter))
    draggingSectionRef.current = null
    setDraggingSection(null)
  }

  function handleSectionPointerStart(id: DashboardSectionId, event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingSectionRef.current = id
    setDraggingSection(id)
  }

  function handleSectionPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const source = draggingSectionRef.current
    if (!source) return

    const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.layout-section')
    const target = targetElement?.dataset.sectionId
    if (!target || !isDashboardSectionId(target) || target === source) return

    const targetRect = targetElement.getBoundingClientRect()
    const placeAfter = event.clientY > targetRect.top + targetRect.height / 2
    setSectionOrder((current) => moveSection(current, source, target, placeAfter))
  }

  function handleSectionPointerEnd() {
    draggingSectionRef.current = null
    setDraggingSection(null)
  }

  function renderDashboardSection(id: DashboardSectionId): ReactNode {
    if (id === 'kpis') {
      return (
        <div className="kpis">
          {kpi.map((item, index) => <KpiCard item={item} index={index} key={item.lab} />)}
        </div>
      )
    }

    if (id === 'trend') {
      return (
        <PerformanceTrend
          period={periodState.trend}
          activeSeries={activeSeries}
          series={series}
          onPeriodChange={(period) => setPanelPeriod('trend', period)}
          onToggleSeries={toggleSeries}
        />
      )
    }

    if (id === 'trafficQuality') {
      return <TrafficQualityPanel report={trafficQuality} />
    }

    if (id === 'clickCaptureHealth') {
      return <ClickCaptureHealthPanel health={captureHealth} />
    }

    if (id === 'campaigns') {
      return (
        <CampaignChart
          period={periodState.camp}
          view={campView}
          campaigns={campaigns}
          onPeriodChange={(period) => setPanelPeriod('camp', period)}
          onViewChange={setCampView}
        />
      )
    }

    if (id === 'searchTerms') {
      return (
        <SearchTerms
          period={periodState.kw}
          tab={kwTab}
          campaignFilter={kwCampaign}
          campaignOptions={campaignOptions}
          keywords={keywords}
          negatives={negatives}
          sortKey={sortKey}
          sortDir={sortDir}
          onPeriodChange={(period) => setPanelPeriod('kw', period)}
          onTabChange={(tab) => {
            setKwTab(tab)
            setSortKey(tab === 'neg' ? 'clicks' : 'leads')
            setSortDir('desc')
          }}
          onCampaignFilterChange={(campaign) => {
            setKwCampaign(campaign)
            setSortKey(kwTab === 'neg' ? 'clicks' : 'leads')
            setSortDir('desc')
          }}
          onSort={handleSort}
        />
      )
    }

    if (id === 'funnel') {
      return (
        <MarketingFunnel
          period={periodState.funnel}
          funnel={funnel}
          callBreakdown={callBreakdown}
          onPeriodChange={(period) => setPanelPeriod('funnel', period)}
          onOpenBreakdown={setSelectedBreakdown}
        />
      )
    }

    if (id === 'exportHealth') {
      return <ExportHealthCard health={exportHealth} />
    }

    if (id === 'heatmaps') {
      return <LandingHeatmapLauncher />
    }

    if (id === 'roster') {
      return (
        <ActiveLeadRoster
          leads={leads}
          period={periodState.roster}
          onPeriodChange={(period) => setPanelPeriod('roster', period)}
          onOpenLead={setSelectedLead}
        />
      )
    }

    if (id === 'outbox') {
      return (
        <LeadOutboxPanel
          rows={outbox}
          period={periodState.outbox}
          onPeriodChange={(period) => setPanelPeriod('outbox', period)}
        />
      )
    }

    return (
      <LatestPaidJourneys
        sessions={paidSessions}
        filter={pjFilter}
        range={pjRange}
        limit={pjLimit}
        page={pjPage}
        onFilterChange={(filter) => { setPjFilter(filter); setPjPage(0) }}
        onRangeChange={setPaidJourneyRange}
        onLimitChange={(limit) => { setPjLimit(limit); setPjPage(0) }}
        onPageChange={setPjPage}
        onOpenSession={setSelectedSession}
        platformClicks={kpiValue(kpi, 'Clicks')}
      />
    )
  }

  const pageHeader = (
    <header className="bar live-only crm-page-header">
      <div className="brand-heading">
        <span>Google Ads intelligence</span>
        <h1>Search performance</h1>
        <p>Campaign delivery, attributed seller leads, call outcomes, and offline conversion health.</p>
      </div>
      <div className="header-status">
        <span className="live-pill"><span className="live-dot" /> {adsData?.syncedLabel ?? 'Loading live data'}</span>
        <span className="fresh-pill">Tracking: {formatFreshness(adsData?.freshness.liveTrackingUpdatedAt)}</span>
        <span className="fresh-pill">Google Ads: {formatFreshness(adsData?.freshness.googleAdsImportedAt)}</span>
        <Link className="fresh-pill call-review-link" href="/marketing/alerts?source=google_ads">Lead Alerts</Link>
        <Link className="fresh-pill call-review-link" href="/marketing/calls?source=google_ads">Call Review</Link>
        <Link className="fresh-pill call-review-link" href="/marketing/heatmaps?source=google_ads">Heatmaps</Link>
      </div>
    </header>
  )

  if (!hasHydrated || !adsData) {
    return (
      <>
        <style>{ADS_COMMAND_STYLES}</style>
        <div className="ads-command" suppressHydrationWarning>
          <div className="wrap">
            {pageHeader}
            <section className={`dashboard-state crm-panel ${loadError ? 'is-error' : ''}`} aria-live="polite">
              <span className="dashboard-state-icon">{loadError ? '!' : ''}</span>
              <div>
                <h2>{loadError ? 'Google Ads data is unavailable' : 'Loading Google Ads performance'}</h2>
                <p>{loadError ?? 'Reading current campaign, attribution, lead, and conversion records.'}</p>
              </div>
              {loadError ? (
                <button type="button" className="crm-secondary-button retry-button" onClick={() => {
                  setLoadError(null)
                  setReloadVersion((current) => current + 1)
                }}>
                  Retry
                </button>
              ) : <span className="dashboard-state-progress" aria-hidden="true" />}
            </section>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{ADS_COMMAND_STYLES}</style>
      <div className="ads-command" suppressHydrationWarning>
        <div className="wrap">
          {pageHeader}

          <div className="layout-grid">
            {sectionOrder.map((sectionId) => (
              <LayoutSection
                id={sectionId}
                key={sectionId}
                collapsed={collapsedSections[sectionId]}
                isDragging={draggingSection === sectionId}
                onToggleCollapsed={toggleSectionCollapsed}
                onDragStart={handleSectionDragStart}
                onDragEnd={handleSectionDragEnd}
                onDragOver={handleSectionDragOver}
                onDrop={handleSectionDrop}
                onPointerStart={handleSectionPointerStart}
                onPointerMove={handleSectionPointerMove}
                onPointerEnd={handleSectionPointerEnd}
              >
                {renderDashboardSection(sectionId)}
              </LayoutSection>
            ))}
          </div>

          <div className="foot">
            SAVING KC • GOOGLE ADS • LIVE CAMPAIGN + CRM ATTRIBUTION DATA
          </div>
        </div>

        {selectedLead ? <JourneyOverlay lead={selectedLead} onClose={() => setSelectedLead(null)} /> : null}
        {selectedSession ? (
          <MicroReplayOverlay
            session={selectedSession}
            leads={leads}
            onClose={() => setSelectedSession(null)}
            onOpenLead={(lead) => setSelectedLead(lead)}
          />
        ) : null}
        {selectedBreakdown ? <BreakdownOverlay breakdown={selectedBreakdown} onClose={() => setSelectedBreakdown(null)} /> : null}
      </div>
    </>
  )
}

const ADS_COMMAND_STYLES = `
.ads-command {
  --bg: var(--crm-canvas);
  --surface: var(--crm-surface);
  --surface-2: var(--crm-surface-subtle);
  --surface-3: var(--crm-surface-hover);
  --surface-4: var(--crm-border-strong);
  --line: var(--crm-border);
  --line-2: var(--crm-border-strong);
  --text: var(--crm-ink);
  --text-secondary: var(--crm-text-muted);
  --text-tertiary: var(--crm-text-dim);
  --accent: var(--crm-brand);
  --accent-bright: var(--crm-brand-hover);
  --success: var(--crm-success);
  --success-soft: var(--crm-success-soft);
  --warning: var(--crm-warning);
  --info: var(--crm-info);
  --info-soft: var(--crm-info-soft);
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 16px;
  --radius-2xl: 18px;
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  --shadow-sm: var(--crm-shadow-sm);
  --shadow-md: var(--crm-shadow-md);
  --shadow-lg: var(--crm-shadow-md);
  --shadow-xl: var(--crm-shadow-md);
}
.ads-command {
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
.ads-command * { box-sizing: border-box; }
.ads-command button,
.ads-command select { font-family: var(--font-sans); }
.ads-command .mono { font-family: var(--font-mono); font-feature-settings: "tnum" 1, "lnum" 1; }
.ads-command .wrap { max-width: 1480px; margin: 0 auto; padding: 20px clamp(16px,2.4vw,32px) 64px; }
.ads-command .bar { display:flex; align-items:center; gap:18px; margin-bottom:18px; }
.ads-command .bar.live-only { justify-content:space-between; flex-wrap:wrap; border:1px solid var(--line); border-radius:var(--radius-xl); background:var(--surface); padding:16px 18px; box-shadow:var(--shadow-sm); }
.ads-command .brand { display:flex; align-items:center; gap:12px; }
.ads-command .brand-heading { min-width:280px; flex:1 1 420px; }
.ads-command .brand-heading span { display:block; margin-bottom:3px; color:var(--accent); font-size:10px; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
.ads-command .brand-heading h1 { margin:0; color:var(--text); font-size:25px; font-weight:900; line-height:1.05; letter-spacing:-.035em; }
.ads-command .brand-heading p { max-width:720px; margin:5px 0 0; color:var(--text-secondary); font-size:12px; font-weight:550; line-height:1.4; }
.ads-command .header-status { display:flex; flex:1 1 620px; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
.ads-command .logo-mark { display:flex; align-items:center; height:32px; padding-right:4px; }
.ads-command .logo-mark img { height:26px; width:auto; max-width:155px; object-fit:contain; }
.ads-command .bar-right { margin-left:auto; display:flex; align-items:center; gap:10px; }
.ads-command .live-pill { display:inline-flex; align-items:center; gap:8px; min-height:30px; font-size:11px; font-weight:800; color:var(--success); background:var(--success-soft); border:1px solid var(--crm-success-border); padding:6px 12px; border-radius:10px; }
.ads-command .fresh-pill { display:inline-flex; align-items:center; min-height:30px; font-size:11px; font-weight:700; color:var(--text-secondary); background:var(--surface); border:1px solid var(--line); padding:6px 10px; border-radius:10px; }
.ads-command .dashboard-state { min-height:180px; display:flex; align-items:center; justify-content:center; gap:16px; border-radius:var(--radius-xl); padding:30px; color:var(--text); }
.ads-command .dashboard-state-icon { width:38px; height:38px; display:grid; place-items:center; border-radius:999px; background:var(--info-soft); color:var(--info); font-size:20px; font-weight:900; }
.ads-command .dashboard-state.is-error .dashboard-state-icon { background:var(--crm-danger-soft); color:var(--crm-danger); }
.ads-command .dashboard-state h2 { margin:0; font-size:18px; font-weight:900; }
.ads-command .dashboard-state p { margin:5px 0 0; color:var(--text-secondary); font-size:12px; }
.ads-command .dashboard-state-progress { width:72px; height:4px; overflow:hidden; border-radius:999px; background:var(--surface-2); }
.ads-command .dashboard-state-progress::after { content:""; display:block; width:38%; height:100%; border-radius:inherit; background:var(--info); animation:adsLoad 1s ease-in-out infinite alternate; }
.ads-command .retry-button { min-height:36px; border-radius:10px; padding:0 15px; font-size:12px; font-weight:850; cursor:pointer; }
@keyframes adsLoad { from { transform:translateX(0); } to { transform:translateX(165%); } }
.ads-command .call-review-link { color:var(--accent); text-decoration:none; font-weight:800; letter-spacing:.02em; }
.ads-command .call-review-link:hover { color:var(--accent-bright); border-color:var(--crm-brand-border); background:var(--crm-brand-soft); }
.ads-command .live-dot { width:7px; height:7px; background:var(--success); border-radius:50%; box-shadow:0 0 0 3px rgba(34,197,94,.2); animation:adsPulse 2s ease-in-out infinite; }
@keyframes adsPulse { 0%,100%{opacity:1} 50%{opacity:.6} }
.ads-command .layout-grid { display:grid; grid-template-columns:minmax(0,1fr); gap:18px 14px; align-items:start; }
.ads-command .layout-section { min-width:0; grid-column:1/-1; border:1px solid transparent; border-radius:var(--radius-2xl); transition:border-color .14s ease, opacity .14s ease, transform .14s ease; }
.ads-command .layout-section.is-dragging { opacity:.55; transform:scale(.997); }
.ads-command .layout-head { min-height:34px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 2px; margin:0 0 8px; }
.ads-command .layout-title { min-width:0; display:flex; align-items:center; gap:9px; color:var(--text-secondary); font-size:10.5px; font-weight:900; letter-spacing:.075em; text-transform:uppercase; }
.ads-command .layout-title span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ads-command .layout-drag,
.ads-command .layout-toggle { width:30px; height:30px; display:grid; place-items:center; border:1px solid var(--line); background:var(--surface-2); color:var(--text-secondary); border-radius:10px; cursor:pointer; font-family:var(--font-mono); font-size:15px; font-weight:900; line-height:1; transition:background .12s ease, border-color .12s ease, color .12s ease; }
.ads-command .layout-drag { cursor:grab; touch-action:none; user-select:none; }
.ads-command .layout-drag:active { cursor:grabbing; }
.ads-command .layout-drag:hover,
.ads-command .layout-toggle:hover { background:var(--surface-3); border-color:var(--line-2); color:var(--text); }
.ads-command .layout-body > .kpis,
.ads-command .layout-body > .panel,
.ads-command .layout-body > .campaign-keyword-grid { margin-bottom:0; }
.ads-command .layout-body > .outbox-panel { margin-top:0; }
.ads-command .layout-collapsed { min-height:56px; display:flex; align-items:center; border:1px dashed var(--line); border-radius:var(--radius-xl); background:var(--surface-2); padding:0 18px; color:var(--text-tertiary); font-size:12px; font-weight:700; }
.ads-command .kpis { display:grid; grid-template-columns:repeat(7,1fr); gap:12px; margin-bottom:26px; }
.ads-command .kpi { background:var(--surface); border:1px solid var(--line); border-top-width:3px; border-radius:var(--radius-xl); padding:15px 16px 14px; box-shadow:var(--shadow-sm); transition:transform .15s cubic-bezier(.23,1,.32,1), box-shadow .15s; }
.ads-command .kpi:nth-child(1) { border-top-color:#11a857; }
.ads-command .kpi:nth-child(2) { border-top-color:#1769e0; }
.ads-command .kpi:nth-child(3) { border-top-color:#00a6a6; }
.ads-command .kpi:nth-child(4) { border-top-color:#7a4ce0; }
.ads-command .kpi:nth-child(5) { border-top-color:#ef7d22; }
.ads-command .kpi:nth-child(6) { border-top-color:#e0a000; }
.ads-command .kpi:nth-child(7) { border-top-color:var(--accent); }
.ads-command .kpi:hover { transform:translateY(-1px); box-shadow:var(--shadow-md); border-color:var(--line-2); }
.ads-command .kpi .label { font-size:10px; font-weight:850; letter-spacing:.06em; text-transform:uppercase; color:var(--text-secondary); margin-bottom:8px; }
.ads-command .kpi .value { font-size:26px; font-weight:900; line-height:1.05; letter-spacing:-.035em; font-variant-numeric:tabular-nums; }
.ads-command .delta { display:inline-flex; align-items:center; gap:4px; margin-top:10px; font-size:12px; font-weight:600; }
.ads-command .delta.up { color:var(--success); }
.ads-command .delta.down { color:var(--accent); }
.ads-command .panel { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-xl); padding:20px 22px; margin-bottom:18px; box-shadow:var(--shadow-sm); min-width:0; }
.ads-command .heatmap-launch { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:18px; margin-bottom:0; background:linear-gradient(135deg,var(--crm-brand-soft),var(--surface) 42%,var(--crm-info-soft)); }
.ads-command .heatmap-copy { min-width:0; }
.ads-command .mini-eyebrow { display:block; margin-bottom:8px; color:var(--accent-bright); font-family:var(--font-mono); font-size:10.5px; font-weight:900; letter-spacing:.12em; }
.ads-command .heatmap-copy h2 { margin:0; font-size:22px; line-height:1.1; letter-spacing:-.02em; }
.ads-command .heatmap-copy p { max-width:760px; margin:8px 0 0; color:var(--text-secondary); font-size:13px; line-height:1.5; }
.ads-command .heatmap-track-list { display:flex; flex-wrap:wrap; gap:7px; margin-top:14px; }
.ads-command .heatmap-track-list span { display:inline-flex; min-height:26px; align-items:center; border:1px solid var(--line); background:var(--surface-2); border-radius:999px; padding:0 10px; color:var(--text-secondary); font-size:12px; font-weight:750; }
.ads-command .heatmap-open { min-height:42px; display:inline-flex; align-items:center; justify-content:center; border-radius:12px; padding:0 18px; color:#fff; background:var(--accent); text-decoration:none; font-size:13px; font-weight:900; box-shadow:0 18px 42px -24px var(--accent); white-space:nowrap; transition:transform .14s ease, filter .14s ease; }
.ads-command .heatmap-open:hover { transform:translateY(-1px); filter:brightness(1.08); }
.ads-command .traffic-quality { margin-bottom:0; overflow:hidden; }
.ads-command .traffic-quality.tq-good { border-color:rgba(34,197,94,.22); }
.ads-command .traffic-quality.tq-watch { border-color:rgba(234,179,8,.28); }
.ads-command .traffic-quality.tq-bad { border-color:rgba(239,68,68,.34); }
.ads-command .traffic-hero { display:grid; grid-template-columns:minmax(0,1fr) 150px; gap:18px; align-items:stretch; margin-bottom:14px; }
.ads-command .traffic-copy { min-width:0; }
.ads-command .traffic-copy h2 { margin:0; font-size:22px; line-height:1.08; letter-spacing:-.02em; }
.ads-command .traffic-copy p { max-width:860px; margin:8px 0 0; color:var(--text-secondary); font-size:13px; line-height:1.5; }
.ads-command .traffic-score { display:flex; flex-direction:column; align-items:flex-end; justify-content:center; min-height:110px; border:1px solid var(--line); border-radius:18px; background:var(--surface-2); padding:14px 16px; }
.ads-command .traffic-score span,
.ads-command .traffic-stat span,
.ads-command .traffic-section-head span { color:var(--text-tertiary); font-size:10px; font-weight:850; letter-spacing:.08em; text-transform:uppercase; }
.ads-command .traffic-score strong { color:var(--text); font-size:42px; line-height:.95; letter-spacing:-.05em; }
.ads-command .traffic-score em,
.ads-command .traffic-stat em { color:var(--text-secondary); font-size:12px; font-style:normal; font-weight:750; }
.ads-command .traffic-cadence { display:grid; grid-template-columns:1.15fr 1fr .92fr .65fr; gap:8px; margin:0 0 14px; }
.ads-command .traffic-cadence > div { min-width:0; border:1px solid var(--line); border-radius:14px; background:var(--surface-2); padding:10px 12px; }
.ads-command .traffic-cadence b { display:block; margin-bottom:4px; color:var(--text); font-size:11px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; }
.ads-command .traffic-cadence span { display:block; color:var(--text-secondary); font-size:12px; line-height:1.35; }
.ads-command .traffic-stats { display:grid; grid-template-columns:repeat(6,1fr); gap:8px; margin-bottom:14px; }
.ads-command .traffic-stat { min-width:0; border:1px solid var(--line); border-radius:14px; background:var(--surface-2); padding:12px; }
.ads-command .traffic-stat strong { display:block; margin:5px 0 3px; color:var(--text); font-size:24px; line-height:1; letter-spacing:-.04em; }
.ads-command .traffic-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }
.ads-command .traffic-issues,
.ads-command .traffic-sources,
.ads-command .traffic-table-wrap { min-width:0; border:1px solid var(--line); border-radius:18px; background:var(--surface-2); padding:14px; }
.ads-command .traffic-section-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:10px; }
.ads-command .traffic-section-head h3 { margin:0; font-size:14px; font-weight:900; letter-spacing:-.01em; }
.ads-command .traffic-issue,
.ads-command .traffic-source-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center; border-top:1px solid var(--line); padding:10px 0; }
.ads-command .traffic-issue:first-of-type,
.ads-command .traffic-source-row:first-of-type { border-top:0; padding-top:0; }
.ads-command .traffic-issue strong,
.ads-command .traffic-source-row strong { display:block; color:var(--text); font-size:13px; font-weight:900; line-height:1.2; }
.ads-command .traffic-issue p,
.ads-command .traffic-source-row span { display:block; margin:3px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.35; }
.ads-command .traffic-issue b,
.ads-command .traffic-source-row b { min-width:42px; text-align:right; color:var(--text); font-size:16px; }
.ads-command .traffic-issue.high b { color:var(--accent-bright); }
.ads-command .traffic-issue.medium b { color:var(--warning); }
.ads-command .traffic-empty { border:1px dashed var(--line); border-radius:14px; padding:18px; color:var(--text-tertiary); font-size:12.5px; text-align:center; }
.ads-command .traffic-table { min-width:980px; }
.ads-command .traffic-table td { vertical-align:top; }
.ads-command .traffic-table td:first-child { width:68px; }
.ads-command .traffic-risk { display:inline-flex; min-width:42px; justify-content:center; border:1px solid var(--line); border-radius:999px; padding:5px 8px; font-family:var(--font-mono); font-size:12px; font-weight:900; }
.ads-command .traffic-risk.good { color:var(--success); border-color:rgba(34,197,94,.35); background:rgba(34,197,94,.09); }
.ads-command .traffic-risk.watch { color:var(--warning); border-color:rgba(234,179,8,.38); background:rgba(234,179,8,.10); }
.ads-command .traffic-risk.bad { color:var(--accent-bright); border-color:rgba(239,68,68,.42); background:rgba(239,68,68,.12); }
.ads-command .traffic-muted { display:block; margin-top:3px; color:var(--text-tertiary); font-size:11px; line-height:1.25; white-space:normal; }
.ads-command .traffic-flags { min-width:210px; text-align:left; }
.ads-command .traffic-flags span { display:inline-flex; margin:0 4px 4px 0; border:1px solid var(--line); border-radius:999px; background:var(--surface-2); color:var(--text-secondary); padding:3px 7px; font-family:var(--font-sans); font-size:11px; font-weight:800; white-space:nowrap; }
.ads-command .panel-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; flex-wrap:wrap; }
.ads-command .panel h2 { font-size:18px; font-weight:700; letter-spacing:-.4px; margin:0 0 2px; }
.ads-command .cap { font-size:12px; color:var(--text-tertiary); font-weight:500; }
.ads-command .panel-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
.ads-command .panel-actions.compact { gap:8px; }
.ads-command .seg { display:inline-flex; background:var(--surface-2); border:1px solid var(--line); border-radius:999px; padding:3px; box-shadow:inset 0 1px 2px rgba(0,0,0,.3); }
.ads-command .seg button { background:none; border:0; color:var(--text-secondary); font-size:12.5px; font-weight:600; padding:7px 16px; border-radius:999px; cursor:pointer; transition:all .1s ease; }
.ads-command .seg button.on { background:var(--surface); color:var(--text); box-shadow:0 1px 3px rgba(0,0,0,.4); font-weight:700; }
.ads-command .date-pill { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--text-secondary); background:var(--surface-2); border:1px solid var(--line); border-radius:999px; padding:5px 6px 5px 14px; font-weight:500; }
.ads-command .date-pill select { appearance:none; background:transparent; border:0; color:var(--text); font-size:12.5px; font-weight:600; padding-right:22px; cursor:pointer; }
.ads-command .series-chips { display:flex; gap:6px; flex-wrap:wrap; }
.ads-command .schip { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; padding:6px 13px; border-radius:999px; border:1px solid var(--line); background:var(--surface-2); color:var(--text-secondary); cursor:pointer; transition:all .1s ease; }
.ads-command .schip i { width:8px; height:8px; border-radius:50%; display:inline-block; }
.ads-command .schip.on { background:var(--surface-3); color:var(--text); border-color:var(--line-2); }
.ads-command .schip.disabled { opacity:.5; cursor:not-allowed; }
.ads-command .chartbox { position:relative; height:260px; }
.ads-command .chartbox.sm { height:238px; }
.ads-command .chart-note { position:absolute; inset:auto 14px 12px 174px; border:1px solid var(--crm-info); background:var(--surface); backdrop-filter:blur(8px); border-radius:var(--radius-lg); padding:10px 12px; color:var(--text-secondary); font-size:11.5px; line-height:1.35; box-shadow:var(--shadow-sm); pointer-events:none; }
.ads-command .chart-note b { display:block; color:var(--text); font-size:12px; margin-bottom:2px; }
.ads-command .campaign-source-list { display:flex; flex-direction:column; gap:7px; margin-top:12px; padding-top:12px; border-top:1px solid var(--line); }
.ads-command .campaign-source-row { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:30px; color:var(--text-secondary); font-size:12px; }
.ads-command .campaign-source-row > span { min-width:0; display:flex; align-items:center; gap:8px; font-weight:750; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ads-command .campaign-source-row i { width:9px; height:9px; border-radius:999px; flex:0 0 auto; }
.ads-command .campaign-source-row b { color:var(--text-tertiary); font-size:11px; white-space:nowrap; }
.ads-command .campaign-empty { min-height:70px; padding:18px; }
.ads-command .campaign-keyword-grid { display:grid; grid-template-columns:1fr 1.28fr; gap:14px; margin-bottom:18px; }
.ads-command .table-scroll { width:100%; overflow-x:auto; overscroll-behavior-x:contain; }
.ads-command table { width:100%; border-collapse:collapse; font-size:13.5px; }
.ads-command th { font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-tertiary); text-align:right; padding:0 10px 12px; border-bottom:1px solid var(--line); }
.ads-command th:first-child,
.ads-command td:first-child { text-align:left; }
.ads-command th.sortable { cursor:pointer; }
.ads-command th.sortable:hover { color:var(--text); }
.ads-command td { padding:8px 10px; border-top:1px solid var(--line); font-family:var(--font-mono); font-weight:500; color:var(--text-secondary); text-align:right; vertical-align:middle; line-height:1.25; }
.ads-command td.kw { font-family:var(--font-sans); font-weight:500; color:var(--text); max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.25; }
.ads-command td.campaign-cell { font-family:var(--font-sans); font-size:12px; color:var(--text-secondary); max-width:150px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.25; }
.ads-command .empty-table { text-align:center !important; padding:28px 16px; color:var(--text-tertiary); font-family:var(--font-sans); }
.ads-command .campaign-filter { max-width:220px; }
.ads-command .neg-btn { font-size:11px; font-weight:600; color:var(--accent); background:rgba(239,68,68,.1); border:1px solid transparent; border-radius:7px; padding:4px 10px; cursor:pointer; transition:.1s; line-height:1.2; white-space:nowrap; }
.ads-command .neg-btn:hover { border-color:var(--accent); background:rgba(239,68,68,.18); }
.ads-command .blocked { color:var(--text-tertiary); font-size:11px; }
.ads-command .keyword-pager { display:flex; align-items:center; justify-content:flex-end; gap:10px; margin-top:10px; padding-top:10px; border-top:1px solid var(--line); color:var(--text-tertiary); font-size:12.5px; font-weight:600; }
.ads-command .keyword-pager-actions { display:flex; align-items:center; gap:8px; }
.ads-command .funnel-v2 { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(320px,.82fr); gap:18px; }
.ads-command .funnel-block { min-width:0; border-top:1px solid var(--line); padding-top:18px; }
.ads-command .funnel-block-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:14px; }
.ads-command .funnel-block h3 { font-size:14px; font-weight:800; margin:0; letter-spacing:.01em; }
.ads-command .funnel-block p { margin:3px 0 0; color:var(--text-tertiary); font-size:12px; }
.ads-command .funnel-content { display:block; }
.ads-command .funnel-table-v2 { border:1px solid var(--line); border-radius:14px; overflow:hidden; background:var(--surface-2); }
.ads-command .ft-row { width:100%; display:grid; grid-template-columns:1.05fr 84px 68px 1.3fr; gap:12px; align-items:center; min-height:44px; padding:10px 13px; border:0; border-top:1px solid var(--line); background:transparent; color:var(--text); text-align:left; cursor:pointer; }
.ads-command .ft-row:first-child { border-top:0; }
.ads-command .ft-row:not(.ft-head):hover,
.ads-command .ft-row.active { background:var(--surface-3); }
.ads-command .ft-head { min-height:34px; background:var(--surface); color:var(--text-tertiary); cursor:default; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; }
.ads-command .ft-row span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12.5px; }
.ads-command .ft-row span:first-child { display:flex; align-items:center; gap:9px; font-weight:700; }
.ads-command .ft-row i { width:9px; height:9px; border-radius:999px; flex-shrink:0; box-shadow:0 0 0 3px var(--surface-2); }
.ads-command .ft-row .mono { color:var(--text-secondary); font-weight:700; }
.ads-command .call-list { display:flex; flex-direction:column; gap:7px; margin-top:8px; }
.ads-command .call-list button { display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center; width:100%; border:1px solid var(--line); background:var(--surface-2); color:var(--text); border-radius:10px; padding:9px 10px; cursor:pointer; text-align:left; }
.ads-command .call-list button:hover { border-color:var(--line-2); background:var(--surface-3); }
.ads-command .call-list span { display:flex; align-items:center; gap:8px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:700; }
.ads-command .call-list i { width:9px; height:9px; border-radius:999px; flex-shrink:0; }
.ads-command .call-list b { font-size:12px; color:var(--text-secondary); }
.ads-command .calls-block { display:flex; flex-direction:column; }
.ads-command .call-total { border:1px solid var(--line); border-radius:999px; padding:7px 12px; color:var(--text); background:var(--surface-2); font-size:12px; font-weight:800; white-space:nowrap; }
.ads-command .calls-content { display:grid; grid-template-columns:1fr; gap:12px; }
.ads-command .calls-donut { position:relative; width:100%; max-width:520px; min-height:330px; margin:2px auto 4px; border:1px solid var(--line); border-radius:18px; background:radial-gradient(circle at 50% 48%, color-mix(in srgb,var(--success) 10%,transparent), transparent 34%), var(--surface-2); overflow:visible; }
.ads-command .calls-donut svg { display:block; width:100%; height:auto; min-height:320px; overflow:visible; }
.ads-command .calls-donut-seg { cursor:pointer; transform-box:fill-box; transform-origin:center; transition:opacity .16s ease, transform .16s ease, filter .16s ease; outline:none; }
.ads-command .calls-donut-seg:hover,
.ads-command .calls-donut-seg:focus-visible { opacity:.95; transform:scale(1.018); filter:brightness(1.08) drop-shadow(0 0 10px color-mix(in srgb,var(--text) 12%,transparent)); }
.ads-command .calls-donut-decor,
.ads-command .calls-donut-total-label,
.ads-command .calls-donut-total { pointer-events:none; }
.ads-command .calls-donut-total-label { fill:var(--text-tertiary); font-size:10px; font-weight:900; letter-spacing:.12em; }
.ads-command .calls-donut-total { fill:var(--text); font-family:var(--font-mono); font-size:30px; font-weight:900; letter-spacing:-.04em; }
.ads-command .calls-donut-label { pointer-events:none; }
.ads-command .calls-donut-label-name { fill:var(--text); font-size:12px; font-weight:900; letter-spacing:.01em; }
.ads-command .calls-donut-label-value { fill:var(--text-secondary); font-family:var(--font-mono); font-size:11px; font-weight:850; }
.ads-command .call-list button { grid-template-columns:1fr auto 42px; }
.ads-command .call-list em { font-style:normal; color:var(--text-tertiary); font-size:12px; text-align:right; }
.ads-command .roster { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
.ads-command .empty-state { grid-column:1/-1; text-align:center; padding:40px 20px; color:var(--text-tertiary); font-size:13px; }
.ads-command .lead { text-align:left; width:100%; background:var(--surface-2); border:1px solid var(--line); border-radius:var(--radius-xl); padding:16px 18px 14px; cursor:pointer; transition:transform .18s cubic-bezier(.23,1,.32,1), border-color .18s, box-shadow .18s; position:relative; overflow:hidden; color:var(--text); }
.ads-command .lead:hover { transform:translateY(-1px); border-color:var(--line-2); box-shadow:var(--shadow-lg); }
.ads-command .lead .play { position:absolute; top:14px; right:14px; width:24px; height:24px; border-radius:50%; background:var(--surface-3); display:grid; place-items:center; font-size:9px; color:var(--accent); opacity:0; transition:.15s; }
.ads-command .lead:hover .play { opacity:1; }
.ads-command .lead-header { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
.ads-command .lead .name { font-weight:700; font-size:15px; letter-spacing:-.3px; line-height:1.2; }
.ads-command .lead-status { font-size:10px; font-weight:700; padding:3px 9px; border-radius:999px; white-space:nowrap; flex-shrink:0; margin-top:2px; }
.ads-command .lead .meta { display:block; font-size:12px; color:var(--text-secondary); margin-top:4px; line-height:1.3; }
.ads-command .lead .kw { font-size:11px; color:var(--text-tertiary); margin-top:8px; display:flex; align-items:center; gap:4px; opacity:.85; }
.ads-command .source-tag { display:inline-flex; align-items:center; min-height:18px; border-radius:999px; border:1px solid var(--crm-info); background:var(--info-soft); color:var(--info); padding:1px 7px; font-size:10px; font-weight:850; letter-spacing:.02em; white-space:nowrap; }
.ads-command .lead-metrics { display:flex; justify-content:space-between; align-items:flex-end; margin-top:14px; }
.ads-command .mini-label { display:block; font-size:9px; color:var(--text-tertiary); font-weight:600; letter-spacing:.5px; }
.ads-command .lead .spread { display:block; font-weight:800; font-size:18px; letter-spacing:-.6px; line-height:1; }
.ads-command .lead .score { text-align:right; }
.ads-command .lead .score .val { display:block; font-weight:700; font-size:16px; line-height:1; }
.ads-command .score-label { display:block; font-size:9px; color:var(--text-tertiary); font-weight:600; letter-spacing:.5px; }
.ads-command .miniprog { display:block; height:3px; background:var(--surface-3); border-radius:999px; margin-top:10px; overflow:hidden; }
.ads-command .miniprog > span { display:block; height:100%; background:linear-gradient(to right,var(--accent),var(--accent-bright)); border-radius:999px; }
.ads-command .export-health-panel { overflow:hidden; }
.ads-command .export-health-state { display:inline-flex; align-items:center; justify-content:center; min-height:28px; border:1px solid; border-radius:999px; padding:4px 12px; font-size:11px; font-weight:900; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; }
.ads-command .export-health-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin-top:4px; }
.ads-command .export-health-metric { min-width:0; border-top:1px solid var(--line); padding-top:12px; }
.ads-command .export-health-metric span,
.ads-command .export-health-note span { display:block; font-size:10px; font-weight:850; color:var(--text-tertiary); letter-spacing:.08em; text-transform:uppercase; }
.ads-command .export-health-metric b { display:block; font-size:24px; line-height:1; margin-top:7px; color:var(--text); }
.ads-command .export-health-foot { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.35fr); gap:18px; margin-top:18px; padding-top:16px; border-top:1px solid var(--line); }
.ads-command .export-health-note { min-width:0; }
.ads-command .export-health-note b { display:block; margin-top:6px; color:var(--text); font-size:14px; line-height:1.35; overflow-wrap:anywhere; }
.ads-command .export-health-note small { display:block; color:var(--text-tertiary); font-size:12px; line-height:1.35; margin-top:4px; overflow-wrap:anywhere; }
.ads-command .click-capture-panel { overflow:hidden; }
.ads-command .capture-health-banner { border:1px solid; border-radius:14px; padding:13px 15px; margin-bottom:14px; }
.ads-command .capture-health-banner b { display:block; color:var(--text); font-size:14px; line-height:1.35; }
.ads-command .capture-health-banner small { display:block; color:var(--text-tertiary); font-size:12px; line-height:1.4; margin-top:4px; }
.ads-command .capture-health-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin-bottom:14px; }
.ads-command .capture-health-metric { min-width:0; border:1px solid var(--line); border-radius:14px; background:var(--surface-2); padding:13px 14px; }
.ads-command .capture-health-metric span { display:block; color:var(--text-tertiary); font-size:10px; font-weight:850; letter-spacing:.08em; text-transform:uppercase; }
.ads-command .capture-health-metric b { display:block; margin-top:8px; color:var(--text); font-size:26px; line-height:1; letter-spacing:-.04em; }
.ads-command .capture-source-list { display:flex; flex-direction:column; gap:12px; }
.ads-command .capture-source-row { min-width:0; border:1px solid var(--line); border-radius:18px; background:var(--surface-2); padding:15px; }
.ads-command .capture-source-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:13px; }
.ads-command .capture-source-head b { display:block; color:var(--text); font-size:15px; line-height:1.2; }
.ads-command .capture-source-head span { display:block; margin-top:4px; color:var(--text-secondary); font-size:12.5px; line-height:1.4; }
.ads-command .capture-source-head em { flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; min-height:26px; border:1px solid; border-radius:999px; padding:4px 10px; font-size:10px; font-style:normal; font-weight:900; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; }
.ads-command .capture-stage-list { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:7px; }
.ads-command .capture-stage { min-width:0; border:1px solid var(--line); border-radius:12px; background:var(--surface); padding:10px; }
.ads-command .capture-stage span { display:block; color:var(--text-tertiary); font-size:9.5px; font-weight:850; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ads-command .capture-stage b { display:block; margin-top:6px; color:var(--text); font-size:21px; line-height:1; }
.ads-command .capture-stage small { display:block; min-height:28px; margin-top:5px; color:var(--text-tertiary); font-size:10.5px; line-height:1.3; }
.ads-command .capture-gap-line { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:12px; padding-top:12px; border-top:1px solid var(--line); color:var(--text-secondary); font-size:12px; line-height:1.35; }
.ads-command .capture-gap-line span:first-child { color:var(--text); font-weight:800; }
.ads-command .outbox-panel { margin-top:14px; }
.ads-command .outbox-summary { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; margin-bottom:14px; }
.ads-command .outbox-summary > div { background:var(--surface-2); border:1px solid var(--line); border-radius:var(--radius-lg); padding:11px 12px; }
.ads-command .outbox-summary span { display:block; font-size:10px; font-weight:800; color:var(--text-tertiary); letter-spacing:.08em; }
.ads-command .outbox-summary b { display:block; font-size:20px; line-height:1.1; margin-top:4px; color:var(--text); }
.ads-command .outbox-table th,
.ads-command .outbox-table td { vertical-align:top; }
.ads-command .outbox-table { min-width:920px; }
.ads-command .outbox-lead-row > td { background:var(--surface); }
.ads-command .outbox-detail-row > td { padding:0 10px 12px; background:var(--surface-2); }
.ads-command .outbox-event,
.ads-command .outbox-lead { display:block; font-weight:800; color:var(--text); line-height:1.25; }
.ads-command .outbox-sub { display:block; color:var(--text-tertiary); font-size:11px; line-height:1.35; margin-top:3px; max-width:290px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ads-command .outbox-source-line { display:flex; align-items:center; gap:7px; max-width:360px; }
.ads-command .outbox-source-line > span:last-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ads-command .outbox-status { display:inline-flex; align-items:center; justify-content:center; min-height:24px; border:1px solid; border-radius:999px; padding:3px 9px; font-size:11px; font-weight:850; white-space:nowrap; }
.ads-command .outbox-error { display:block; color:var(--danger); font-size:11px; line-height:1.25; margin-top:3px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ads-command .outbox-expand { display:flex; align-items:flex-start; gap:10px; width:100%; background:none; border:0; color:var(--text); padding:0; text-align:left; cursor:pointer; font:inherit; }
.ads-command .outbox-expand > span:first-child { width:22px; height:22px; display:grid; place-items:center; border:1px solid var(--line); border-radius:7px; background:var(--surface-2); color:var(--accent-bright); font-family:var(--font-mono); font-weight:900; flex:0 0 auto; }
.ads-command .outbox-events { margin:8px 0 0 32px; border:1px solid var(--line); border-radius:var(--radius-lg); overflow:hidden; background:var(--surface-2); }
.ads-command .outbox-event-line { display:grid; grid-template-columns:minmax(180px,1.1fr) 150px minmax(130px,.8fr) 80px 130px 58px; gap:12px; align-items:start; padding:10px 12px; border-top:1px solid var(--line); color:var(--text-secondary); font-size:12px; }
.ads-command .outbox-event-line:first-child { border-top:0; }
.ads-command .outbox-event-line small { display:block; color:var(--text-tertiary); font-family:var(--font-mono); margin-top:3px; }
.ads-command .sec-title { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
.ads-command .sec-title h2 { font-size:17px; font-weight:700; margin:0; letter-spacing:-.3px; }
.ads-command .pj-metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
.ads-command .pjm { background:var(--surface-2); border:1px solid var(--line); border-radius:var(--radius-lg); padding:18px 20px; text-align:center; }
.ads-command .pjm .l { font-size:12px; color:var(--text-tertiary); font-weight:600; letter-spacing:.02em; }
.ads-command .pjm .v { font-weight:800; font-size:38px; line-height:1; margin-top:4px; letter-spacing:-1.5px; }
.ads-command .pjm.green .v { color:var(--success); }
.ads-command .pjm.blue .v { color:var(--info); }
.ads-command .pjm.purple .v { color:#a78bfa; }
.ads-command .pjm.red .v { color:var(--accent); }
.ads-command .pj-window-note { border:1px solid rgba(96,165,250,.28); background:rgba(96,165,250,.07); border-radius:var(--radius-lg); padding:12px 16px; margin:-6px 0 16px; display:flex; align-items:flex-start; gap:10px; color:var(--text-secondary); font-size:12.5px; line-height:1.45; }
.ads-command .pj-window-note b { color:var(--text); overflow-wrap:anywhere; }
.ads-command .pj-gap { border:1px solid rgba(167,139,250,.35); background:rgba(167,139,250,.08); border-radius:var(--radius-lg); padding:13px 16px; margin:-6px 0 16px; display:flex; align-items:flex-start; gap:10px; color:var(--text-secondary); font-size:12.5px; line-height:1.45; }
.ads-command .pj-gap b { color:var(--text); overflow-wrap:anywhere; }
.ads-command .pj-empty { border:1px dashed var(--line-2); border-radius:var(--radius-lg); background:var(--surface-2); padding:28px 18px; color:var(--text-secondary); display:flex; flex-direction:column; gap:6px; text-align:center; }
.ads-command .pj-empty b { color:var(--text); }
.ads-command .pj-controls { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
.ads-command .pj-tabs { display:inline-flex; border:1px solid var(--line); border-radius:var(--radius-md); overflow:hidden; background:var(--surface-2); }
.ads-command .pj-tabs button { background:none; border:0; color:var(--text-secondary); font-size:12.5px; font-weight:600; padding:8px 15px; cursor:pointer; }
.ads-command .pj-tabs button.on { background:var(--surface); color:var(--text); box-shadow:var(--shadow-sm); }
.ads-command .gsel { font-size:13px; color:var(--text); background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md); padding:7px 32px 7px 12px; cursor:pointer; appearance:none; }
.ads-command .pager { margin-left:auto; display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--text-tertiary); }
.ads-command .pager-btn { border:1px solid var(--line); background:var(--surface-2); color:var(--text); padding:5px 11px; border-radius:8px; cursor:pointer; }
.ads-command .pager-btn:disabled { opacity:.45; cursor:not-allowed; }
.ads-command .paid-list { display:flex; flex-direction:column; gap:8px; }
.ads-command .paid-row { width:100%; display:grid; grid-template-columns:78px 1fr 128px; gap:16px; align-items:center; background:var(--surface-2); border:1px solid var(--line); border-radius:var(--radius-lg); padding:13px 18px; cursor:pointer; transition:all .12s cubic-bezier(.23,1,.32,1); color:var(--text); text-align:left; }
.ads-command .paid-row:hover { border-color:var(--line-2); background:var(--surface-3); }
.ads-command .paid-time { font-family:var(--font-mono); font-size:13px; font-weight:700; text-align:center; line-height:1.2; }
.ads-command .paid-time small { display:block; font-size:9.5px; color:var(--text-tertiary); font-weight:500; margin-top:1px; }
.ads-command .paid-camp { font-weight:700; font-size:14.5px; display:flex; align-items:center; gap:8px; }
.ads-command .gclid { font-family:var(--font-mono); font-size:10px; color:var(--text-tertiary); background:var(--surface-3); padding:1px 6px; border-radius:4px; }
.ads-command .paid-meta { font-size:12px; color:var(--text-tertiary); margin:4px 0 7px; display:flex; gap:10px; flex-wrap:wrap; }
.ads-command .paid-bar { display:grid; grid-template-columns:repeat(10,1fr); gap:3px; height:7px; }
.ads-command .paid-seg { height:100%; border-radius:999px; background:var(--surface-3); }
.ads-command .paid-seg.done { background:var(--success); }
.ads-command .paid-seg.current { background:var(--warning); box-shadow:0 0 0 2px rgba(234,179,8,.3); }
.ads-command .paid-seg.miss { background:rgba(239,68,68,.2); border:1px dashed var(--accent); }
.ads-command .paid-status { font-size:12px; font-weight:700; padding:6px 13px; border-radius:999px; display:inline-flex; align-items:center; gap:6px; justify-content:center; }
.ads-command .paid-status.lead { color:var(--success); background:rgba(34,197,94,.1); }
.ads-command .paid-status.nolead { color:var(--text-tertiary); background:var(--surface-3); }
.ads-command .foot { text-align:center; font-size:11px; color:var(--text-tertiary); margin-top:48px; font-family:var(--font-mono); letter-spacing:.5px; }
.ads-command .overlay { position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,.85); backdrop-filter:blur(16px); display:block; opacity:1; }
.ads-command .stage { position:absolute; inset:16px; width:min(1540px,calc(100vw - 32px)); max-width:none; left:50%; transform:translateX(-50%) scale(1); background:var(--surface); border:1px solid var(--line); border-radius:20px; overflow:hidden; box-shadow:var(--shadow-xl); display:flex; flex-direction:column; }
.ads-command .stage-top { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:18px; padding:18px 26px; border-bottom:1px solid var(--line); background:var(--surface-2); }
.ads-command .back { background:var(--surface-3); border:1px solid var(--line); color:var(--text); border-radius:999px; padding:8px 18px; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:7px; transition:.1s; }
.ads-command .back:hover { background:var(--surface-4); }
.ads-command .eyebrow { font-size:11px; color:var(--text-tertiary); font-weight:600; }
.ads-command .qname { font-size:21px; font-weight:700; letter-spacing:-.4px; overflow-wrap:anywhere; }
.ads-command .qbadges { display:flex; gap:8px; margin-left:auto; flex-wrap:wrap; }
.ads-command .qb { font-size:12px; padding:5px 12px; border-radius:999px; background:var(--surface-3); color:var(--text-secondary); border:1px solid var(--line); font-weight:600; }
.ads-command .stage-body { flex:1; display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,340px); overflow:hidden; }
.ads-command .map { padding:26px 30px; overflow:auto; }
.ads-command .maptitle,
.ads-command .timeline-title { font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--text-tertiary); margin-bottom:18px; }
.ads-command .board { display:flex; flex-wrap:wrap; gap:4px 0; }
.ads-command .node { width:25%; min-width:148px; padding:0 10px 28px; position:relative; }
.ads-command .node .conn { position:absolute; top:26px; left:50%; width:100%; height:2px; background:var(--line); z-index:0; }
.ads-command .node:last-child .conn { display:none; }
.ads-command .orb { width:52px; height:52px; border-radius:14px; background:var(--surface-2); border:1px solid var(--line); display:grid; place-items:center; position:relative; z-index:2; color:var(--text-tertiary); }
.ads-command .node.done .orb { background:var(--success-soft); border-color:var(--success); color:var(--success); }
.ads-command .node.current .orb { background:var(--accent); border-color:var(--accent); color:white; box-shadow:0 0 0 5px rgba(239,68,68,.2); }
.ads-command .xp-tag { position:absolute; top:-5px; right:8px; font-size:9px; background:#eab308; color:#111; font-weight:700; padding:1px 5px; border-radius:999px; }
.ads-command .nlabel { font-size:12.5px; font-weight:600; margin-top:10px; text-align:center; }
.ads-command .nmeta { font-size:10px; color:var(--text-tertiary); text-align:center; margin-top:2px; font-family:var(--font-mono); }
.ads-command .statside,
.ads-command .micro-side { border-left:1px solid var(--line); background:var(--surface-2); padding:26px 22px; overflow:auto; }
.ads-command .charcard { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-lg); padding:18px; margin-bottom:16px; }
.ads-command .campaign-label { font-size:11px; color:#f87171; font-weight:700; }
.ads-command .char-name { font-size:19px; font-weight:700; margin:3px 0 6px; }
.ads-command .char-meta { font-size:12.5px; color:var(--text-secondary); line-height:1.5; }
.ads-command .score-row { display:flex; align-items:center; gap:14px; margin-top:16px; }
.ads-command .score-ring { position:relative; width:56px; height:56px; }
.ads-command .score-ring > div { position:absolute; inset:0; display:grid; place-items:center; font-family:var(--font-mono); font-weight:800; font-size:16px; }
.ads-command .verdict { font-weight:800; }
.ads-command .score-caption { font-size:10px; color:var(--text-tertiary); }
.ads-command .statgrid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.ads-command .stat { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:11px 13px; }
.ads-command .sl { font-size:10px; color:var(--text-tertiary); font-weight:600; }
.ads-command .ss { font-weight:700; font-size:18px; margin-top:3px; }
.ads-command .green { color:#22c55e; }
.ads-command .blue { color:#60a5fa; }
.ads-command .purple { color:#a78bfa; }
.ads-command .gold { color:#eab308; }
.ads-command .red { color:#f87171; }
.ads-command .journey-log { margin-top:14px; font-size:12px; }
.ads-command .log-item { padding-bottom:9px; border-left:2px solid var(--line); margin-left:7px; padding-left:13px; position:relative; }
.ads-command .step-id { font-family:var(--font-mono); font-size:10px; color:var(--text-tertiary); }
.ads-command .log-title { font-weight:600; }
.ads-command .log-detail { color:var(--text-secondary); font-size:12px; }
.ads-command .micro-body { flex:1; display:grid; grid-template-columns:minmax(0,1fr) minmax(360px,440px); overflow:hidden; }
.ads-command .micro-main { min-width:0; padding:28px 32px; overflow:auto; }
.ads-command .micro-side { min-width:0; }
.ads-command .micro-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:22px; }
.ads-command .ms { min-width:0; background:var(--surface-2); border:1px solid var(--line); border-radius:12px; padding:13px 15px; }
.ads-command .ms .l { font-size:10px; color:var(--text-tertiary); font-weight:600; }
.ads-command .ms .v { font-weight:800; font-size:21px; margin-top:4px; line-height:1.05; }
.ads-command .ms .v.small { font-size:14px; }
.ads-command .me { position:relative; padding-left:38px; padding-bottom:18px; }
.ads-command .me .icon { position:absolute; left:0; top:0; width:28px; height:28px; border-radius:9px; background:var(--surface-2); border:1px solid var(--line); display:grid; place-items:center; color:var(--text-tertiary); }
.ads-command .me.done .icon { background:var(--success-soft); border-color:var(--success); color:var(--success); }
.ads-command .me.current .icon { background:rgba(234,179,8,.15); border-color:var(--warning); color:var(--warning); }
.ads-command .me .lab { font-weight:600; font-size:14px; }
.ads-command .event-act { font-size:12px; color:var(--text-secondary); margin-top:3px; }
.ads-command .event-act.muted { color:var(--text-tertiary); }
.ads-command .dwell { margin-top:6px; height:3px; background:var(--line); border-radius:999px; }
.ads-command .dwell span { display:block; height:100%; background:#eab308; border-radius:999px; }
.ads-command .drop-node { margin-left:38px; margin-top:-6px; padding-bottom:12px; color:#f87171; }
.ads-command .drop-title { font-weight:700; }
.ads-command .drop-detail { font-size:12.5px; color:var(--text-secondary); }
.ads-command .side-label { font-size:10px; font-weight:700; color:var(--text-tertiary); margin-bottom:8px; }
.ads-command .side-label.spaced { margin-top:18px; }
.ads-command .side-copy { font-size:12.5px; line-height:1.6; color:var(--text-secondary); }
.ads-command .side-cta { margin-top:18px; padding:16px; border-radius:12px; font-weight:700; }
.ads-command .side-cta.converted { border:1px solid #22c55e; background:#14532d; color:#4ade80; }
.ads-command .side-cta.nolead { border:1px solid #f87171; background:#3f1c1c; color:#f87171; }
.ads-command .side-cta button { margin-top:10px; background:#22c55e; color:#111; border:0; padding:9px 18px; border-radius:999px; font-weight:700; font-size:12.5px; cursor:pointer; }
.ads-command .side-buttons { display:flex; gap:6px; margin-top:10px; }
.ads-command .side-buttons button { margin-top:0; background:#3f1c1c; color:#f87171; border:1px solid #f87171; padding:7px 14px; border-radius:999px; font-size:12px; }
.ads-command .side-buttons button:disabled { cursor:not-allowed; opacity:.5; }
.ads-command .breakdown-modal { position:absolute; inset:auto 24px; top:50%; left:50%; width:min(720px,calc(100vw - 32px)); max-height:calc(100vh - 48px); transform:translate(-50%,-50%); background:var(--surface); border:1px solid var(--line); border-radius:20px; overflow:hidden; box-shadow:var(--shadow-xl); display:flex; flex-direction:column; }
.ads-command .breakdown-body { padding:24px 26px 28px; overflow:auto; }
.ads-command .breakdown-total { display:grid; grid-template-columns:1fr auto auto; align-items:end; gap:10px; border:1px solid var(--line); background:var(--surface-2); border-radius:14px; padding:14px 16px; margin-bottom:14px; }
.ads-command .breakdown-total span { color:var(--text-tertiary); font-size:11px; font-weight:800; text-transform:uppercase; }
.ads-command .breakdown-total strong { font-size:24px; line-height:1; }
.ads-command .breakdown-total em { color:var(--text-secondary); font-style:normal; font-size:12px; padding-bottom:2px; }
.ads-command .breakdown-list { display:flex; flex-direction:column; gap:11px; }
.ads-command .breakdown-item { border:1px solid var(--line); border-radius:14px; padding:12px 13px; background:var(--surface-2); }
.ads-command .breakdown-line { display:flex; justify-content:space-between; align-items:center; gap:16px; }
.ads-command .breakdown-line span { display:flex; align-items:center; gap:9px; font-weight:800; font-size:13px; min-width:0; }
.ads-command .breakdown-line i { width:10px; height:10px; border-radius:999px; flex-shrink:0; }
.ads-command .breakdown-line b { color:var(--text-secondary); font-size:12px; white-space:nowrap; }
.ads-command .breakdown-bar { height:5px; background:var(--line); border-radius:999px; overflow:hidden; margin-top:9px; }
.ads-command .breakdown-bar span { display:block; height:100%; border-radius:999px; }
.ads-command .breakdown-item p { margin:7px 0 0; color:var(--text-tertiary); font-size:12px; }
@media (min-width:1101px) { .ads-command .layout-grid { grid-template-columns:minmax(0,1fr) minmax(0,1.28fr); } .ads-command .layout-section.full { grid-column:1/-1; } .ads-command .layout-section.half { grid-column:auto / span 1; } }
@media (max-width:1280px) { .ads-command .kpis { grid-template-columns:repeat(4,1fr); } }
@media (max-width:1100px) { .ads-command .roster { grid-template-columns:repeat(2,1fr); } .ads-command .campaign-keyword-grid, .ads-command .funnel-v2, .ads-command .funnel-content { grid-template-columns:1fr; } }
@media (max-width:1100px) { .ads-command .capture-health-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .ads-command .capture-stage-list { grid-template-columns:repeat(4,minmax(0,1fr)); } }
@media (max-width:780px) { .ads-command .capture-health-grid, .ads-command .capture-stage-list { grid-template-columns:repeat(2,minmax(0,1fr)); } .ads-command .capture-source-head, .ads-command .capture-gap-line { flex-direction:column; align-items:flex-start; } }
@media (max-width:920px) { .ads-command .stage-top { grid-template-columns:1fr; align-items:flex-start; } .ads-command .qbadges { margin-left:0; } .ads-command .stage-body, .ads-command .micro-body { grid-template-columns:1fr; } .ads-command .statside, .ads-command .micro-side { display:none; } .ads-command .stage { inset:10px; width:auto; } }
@media (max-width:720px) { .ads-command .kpis { grid-template-columns:repeat(2,1fr); } .ads-command .wrap { padding-inline:14px; } .ads-command .bar.live-only { padding:14px; } .ads-command .header-status { justify-content:flex-start; } .ads-command .panel { padding:18px 15px; overflow:hidden; } .ads-command .heatmap-launch { grid-template-columns:1fr; } .ads-command .heatmap-open { width:100%; } .ads-command .table-scroll table { min-width:680px; } .ads-command .export-health-grid, .ads-command .outbox-summary { grid-template-columns:repeat(2,1fr); } .ads-command .export-health-foot { grid-template-columns:1fr; } .ads-command .ft-row { grid-template-columns:1fr 70px 52px; } .ads-command .ft-row span:last-child { grid-column:1/-1; color:var(--text-tertiary); } .ads-command .campaign-source-row { align-items:flex-start; flex-direction:column; gap:4px; } .ads-command .paid-row { grid-template-columns:64px 1fr; } .ads-command .paid-status { grid-column:2; justify-self:start; } .ads-command .micro-summary, .ads-command .pj-metrics { grid-template-columns:1fr; } .ads-command .breakdown-total { grid-template-columns:1fr; align-items:start; } .ads-command .breakdown-line { align-items:flex-start; flex-direction:column; gap:6px; } }
@media (max-width:640px) { .ads-command .roster { grid-template-columns:1fr; } .ads-command .live-pill { font-size:11px; } }
`
