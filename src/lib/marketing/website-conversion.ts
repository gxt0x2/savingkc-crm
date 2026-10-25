export const CONVERSION_RANGES = ['day', 'week', 'month', 'quarter', 'year'] as const
export type ConversionRange = (typeof CONVERSION_RANGES)[number]

export const CHICAGO_TIME_ZONE = 'America/Chicago'

export const SOURCE_KEYS = ['chatgpt', 'google_organic', 'bing_organic', 'google_cpc', 'direct', 'other'] as const
export type SourceKey = (typeof SOURCE_KEYS)[number]

export const LOW_ENGAGEMENT_RATE = 0.15
export const LOW_ENGAGEMENT_MIN_SESSIONS = 10
export const ZERO_FORM_MIN_SESSIONS = 20
export const CALL_BOUNCE_MIN_SESSIONS = 5

export const LANDING_EVENT_NAMES = ['ppc_landing_request', 'ppc_visit_started'] as const
export const PHONE_EVENT_NAMES = ['phone_click', 'skc_phone_number_selected'] as const
export const EXCLUDED_EVENT_NAMES = ['legacy_attribution_backfill'] as const

export const GSC_AGGREGATION_NOTE = 'Clicks and impressions are summed across query, country, and device. Position is the impression-weighted average. Stored CTR is ignored and recomputed from those sums. Search Console omits some low-volume rows, so totals can undercount.'

const SOURCE_LABELS: Record<SourceKey, string> = {
  chatgpt: 'chatgpt.com / ai-assistant',
  google_organic: 'google / organic',
  bing_organic: 'bing / organic',
  google_cpc: 'google / cpc',
  direct: 'direct',
  other: 'other',
}

const LANDING_EVENTS = new Set<string>(LANDING_EVENT_NAMES)
const PHONE_EVENTS = new Set<string>(PHONE_EVENT_NAMES)
const EXCLUDED_EVENTS = new Set<string>(EXCLUDED_EVENT_NAMES)

export type Ga4LandingRow = {
  date: string
  landing_page: string | null
  session_source_medium: string | null
  sessions: number | null
  engaged_sessions: number | null
  synced_at?: string | null
}

export type GscQueryRow = {
  date: string
  page: string | null
  clicks: number | null
  impressions: number | null
  position: number | null
  synced_at?: string | null
}

export type ConversionLeadRow = {
  source: string | null
  created_at: string | null
}

export type ConversionTrackingRow = {
  event_name: string | null
  event_time: string | null
  session_id: string | null
  is_test?: boolean | null
}

export type AnalyticsSyncRun = {
  source: string | null
  mode: string | null
  started_at: string | null
  finished_at: string | null
  since_date: string | null
  until_date: string | null
  status: string | null
  rows_upserted: number | null
  error: string | null
}

export type MetricStatus = 'ready' | 'missing'

export type SyncFreshness = {
  coveredThrough: string | null
  latestStatus: string | null
  latestMode: string | null
  latestStartedAt: string | null
  latestFinishedAt: string | null
  latestUntil: string | null
  latestError: string | null
}

export type SourceSplitRow = {
  key: SourceKey
  label: string
  sessions: number
  engagedSessions: number
  engagementRate: number | null
  share: number | null
}

export type LandingPageRow = {
  path: string
  sessions: number
  engagedSessions: number
  engagementRate: number | null
}

export type SeriesPoint = {
  date: string
  sessions: number | null
  engagedSessions: number | null
  clicks: number | null
  impressions: number | null
}

export type ChartPoint = {
  label: string
  sessions: number | null
  engagedSessions: number | null
  clicks: number | null
}

export type ConversionSuggestion = {
  id: string
  severity: 'act' | 'watch'
  title: string
  detail: string
  rule: string
}

export type WebsiteConversionReport = {
  generatedAt: string
  range: ConversionRange
  timeZone: typeof CHICAGO_TIME_ZONE
  anchorDate: string
  window: { start: string; end: string; label: string; days: number }
  freshness: { ga4: SyncFreshness; gsc: SyncFreshness }
  ga4: {
    status: MetricStatus
    rowCount: number
    sessions: number | null
    engagedSessions: number | null
    engagementRate: number | null
    daysWithRows: number
    latestDate: string | null
    latestSyncedAt: string | null
  }
  gsc: {
    status: MetricStatus
    rowCount: number
    clicks: number | null
    impressions: number | null
    ctr: number | null
    averagePosition: number | null
    daysWithRows: number
    latestDate: string | null
    latestSyncedAt: string | null
    aggregation: string
  }
  sources: SourceSplitRow[]
  landingPagesBySessions: LandingPageRow[]
  landingPagesByEngaged: LandingPageRow[]
  leads: {
    status: MetricStatus
    websiteForm: number | null
    googleAdsPhone: number | null
    googleAdsTaxPhone: number | null
  }
  funnel: {
    status: MetricStatus
    landingEvents: number | null
    laterEvents: number | null
    landingSessions: number | null
    laterSessions: number | null
    sessionsWithLaterEvent: number | null
    unsessionedLandingEvents: number | null
  }
  rates: {
    sessionToForm: number | null
    engagedToForm: number | null
  }
  callIntent: {
    telClicks: number | null
    googleAdsPhoneLeads: number | null
    telStatus: MetricStatus
    leadStatus: MetricStatus
  }
  series: SeriesPoint[]
  chart: ChartPoint[]
  suggestions: ConversionSuggestion[]
}

export function isConversionRange(value: string | null | undefined): value is ConversionRange {
  return CONVERSION_RANGES.includes(value as ConversionRange)
}

export function chicagoToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function addIsoDays(isoDate: string, days: number): string {
  const next = new Date(`${isoDate}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

export function lastCompleteAnalyticsDay(now = new Date()): string {
  return addIsoDays(chicagoToday(now), -1)
}

export function eachIsoDate(start: string, end: string): string[] {
  const dates: string[] = []
  for (let cursor = start; cursor <= end && dates.length < 400; cursor = addIsoDays(cursor, 1)) dates.push(cursor)
  return dates
}

function weekdayIndex(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay()
}

function mondayOf(isoDate: string): string {
  const day = weekdayIndex(isoDate)
  return addIsoDays(isoDate, day === 0 ? -6 : 1 - day)
}

function quarterStart(isoDate: string): string {
  const month = Number(isoDate.slice(5, 7))
  const startMonth = Math.floor((month - 1) / 3) * 3 + 1
  return `${isoDate.slice(0, 4)}-${String(startMonth).padStart(2, '0')}-01`
}

function mediumDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)))
}

function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function rangeWindow(range: ConversionRange, anchorDate: string): WebsiteConversionReport['window'] {
  const end = anchorDate
  const start = range === 'day'
    ? anchorDate
    : range === 'week'
      ? mondayOf(anchorDate)
      : range === 'month'
        ? `${anchorDate.slice(0, 7)}-01`
        : range === 'quarter'
          ? quarterStart(anchorDate)
          : `${anchorDate.slice(0, 4)}-01-01`
  const days = eachIsoDate(start, end).length
  const label = start === end ? mediumDate(end) : `${shortDate(start)} – ${mediumDate(end)}`
  return { start, end, label, days }
}

export function chicagoMidnightUtc(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utcGuess)
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'))
  return new Date(utcGuess.getTime() - (asUtc - utcGuess.getTime()))
}

export function chicagoRangeInstants(start: string, end: string): { startIso: string; endIso: string } {
  return {
    startIso: chicagoMidnightUtc(start).toISOString(),
    endIso: chicagoMidnightUtc(addIsoDays(end, 1)).toISOString(),
  }
}

export function bucketSessionSource(value: string | null | undefined): SourceKey {
  const text = (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (text === 'chatgpt.com / ai-assistant') return 'chatgpt'
  if (text === 'google / organic') return 'google_organic'
  if (text === 'bing / organic') return 'bing_organic'
  if (text === 'google / cpc') return 'google_cpc'
  if (text === '(direct) / (none)' || text === '(direct) / none' || text === 'direct / (none)' || text === 'direct / none') return 'direct'
  return 'other'
}

export function normalizeLandingPath(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw || raw === '(not set)' || raw === '(none)' || raw.toLowerCase() === 'not set') return '(not set)'
  let path = raw
  if (/^https?:\/\//i.test(raw)) {
    try {
      path = new URL(raw).pathname || '/'
    } catch {
      path = raw
    }
  }
  path = path.split('?')[0]?.split('#')[0] || '/'
  if (!path.startsWith('/')) path = `/${path}`
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path || '/'
}

function finite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return part / whole
}

export function syncFreshness(runs: AnalyticsSyncRun[], source: 'ga4' | 'gsc'): SyncFreshness {
  const mine = runs.filter((run) => run.source === source)
  const latest = [...mine].sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0] ?? null
  const coveredThrough = mine
    .filter((run) => run.status === 'ok' && run.until_date)
    .map((run) => run.until_date as string)
    .sort()
    .at(-1) ?? null
  return {
    coveredThrough,
    latestStatus: latest?.status ?? null,
    latestMode: latest?.mode ?? null,
    latestStartedAt: latest?.started_at ?? null,
    latestFinishedAt: latest?.finished_at ?? null,
    latestUntil: latest?.until_date ?? null,
    latestError: latest?.status === 'ok' ? null : latest?.error ?? null,
  }
}

function sectionStatus(rowCount: number | null, coveredThrough: string | null, windowStart: string): MetricStatus {
  if (rowCount === null) return 'missing'
  if (rowCount > 0) return 'ready'
  if (coveredThrough && coveredThrough >= windowStart) return 'ready'
  return 'missing'
}

function dayValue(status: MetricStatus, coveredThrough: string | null, date: string, value: number | undefined): number | null {
  if (status === 'missing') return null
  if (value !== undefined) return value
  if (coveredThrough && date <= coveredThrough) return 0
  return null
}

function pageRow(path: string, sessions: number, engagedSessions: number): LandingPageRow {
  return { path, sessions, engagedSessions, engagementRate: rate(engagedSessions, sessions) }
}

function isAboutPath(path: string): boolean {
  return path === '/about' || path === '/about-us'
}

export function buildSuggestions(input: {
  ga4Status: MetricStatus
  sessions: number | null
  pages: LandingPageRow[]
  websiteForm: number | null
  leadsStatus: MetricStatus
}): ConversionSuggestion[] {
  if (input.ga4Status !== 'ready') return []
  const suggestions: ConversionSuggestion[] = []
  const sessions = input.sessions ?? 0
  if (input.leadsStatus === 'ready' && input.websiteForm === 0 && sessions > ZERO_FORM_MIN_SESSIONS) {
    suggestions.push({
      id: 'zero-form-cvr',
      severity: 'act',
      title: 'Form conversion is 0%',
      detail: `${sessions.toLocaleString('en-US')} sessions and 0 leads with source website_form. Those leads are not split by landing page.`,
      rule: `form CVR = 0 and sessions > ${ZERO_FORM_MIN_SESSIONS}`,
    })
  }
  const callPage = input.pages.find((page) => page.path === '/call')
  if (callPage && callPage.sessions >= CALL_BOUNCE_MIN_SESSIONS && (callPage.engagementRate ?? 0) < LOW_ENGAGEMENT_RATE) {
    suggestions.push({
      id: 'call-bounce',
      severity: 'act',
      title: '/call is bouncing',
      detail: `${callPage.engagedSessions.toLocaleString('en-US')} engaged sessions out of ${callPage.sessions.toLocaleString('en-US')} on /call.`,
      rule: `/call engaged rate < ${LOW_ENGAGEMENT_RATE * 100}% and sessions >= ${CALL_BOUNCE_MIN_SESSIONS}`,
    })
  }
  const lowEngagement = input.pages
    .filter((page) => page.path !== '/call' && page.path !== '(not set)' && page.sessions >= LOW_ENGAGEMENT_MIN_SESSIONS && (page.engagementRate ?? 0) < LOW_ENGAGEMENT_RATE)
    .sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path))
  for (const page of lowEngagement) {
    suggestions.push({
      id: `low-engagement:${page.path}`,
      severity: 'watch',
      title: `${page.path} engagement is under 15%`,
      detail: `${page.engagedSessions.toLocaleString('en-US')} engaged sessions out of ${page.sessions.toLocaleString('en-US')}.`,
      rule: `engaged rate < ${LOW_ENGAGEMENT_RATE * 100}% and sessions >= ${LOW_ENGAGEMENT_MIN_SESSIONS}`,
    })
  }
  const about = input.pages.find((page) => isAboutPath(page.path) && page.sessions > 0)
  if (about) {
    suggestions.push({
      id: 'about-form-below-fold',
      severity: 'watch',
      title: 'About form sits below the fold',
      detail: `${about.path} recorded ${about.sessions.toLocaleString('en-US')} sessions. The seller form on that page is below the fold.`,
      rule: 'About page received sessions and its form is below the fold',
    })
  }
  const reserved = suggestions.filter((item) => item.severity === 'act' || item.id === 'about-form-below-fold')
  const rest = suggestions.filter((item) => !reserved.includes(item))
  return [...reserved, ...rest].slice(0, 8)
}

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

function sumKnown(values: Array<number | null>): number | null {
  if (values.every((value) => value === null)) return null
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

export function chartPoints(series: SeriesPoint[], range: ConversionRange): ChartPoint[] {
  if (range === 'year') {
    const groups = new Map<string, SeriesPoint[]>()
    for (const point of series) {
      const key = monthKey(point.date)
      groups.set(key, [...(groups.get(key) ?? []), point])
    }
    return [...groups.entries()].map(([key, points]) => ({
      label: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(`${key}-01T12:00:00Z`)),
      sessions: sumKnown(points.map((point) => point.sessions)),
      engagedSessions: sumKnown(points.map((point) => point.engagedSessions)),
      clicks: sumKnown(points.map((point) => point.clicks)),
    }))
  }
  if (range === 'quarter') {
    const groups = new Map<string, SeriesPoint[]>()
    for (const point of series) {
      const key = mondayOf(point.date)
      groups.set(key, [...(groups.get(key) ?? []), point])
    }
    return [...groups.entries()].map(([key, points]) => ({
      label: shortDate(key),
      sessions: sumKnown(points.map((point) => point.sessions)),
      engagedSessions: sumKnown(points.map((point) => point.engagedSessions)),
      clicks: sumKnown(points.map((point) => point.clicks)),
    }))
  }
  return series.map((point) => ({
    label: range === 'week'
      ? new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${point.date}T12:00:00Z`))
      : range === 'month'
        ? String(Number(point.date.slice(8, 10)))
        : shortDate(point.date),
    sessions: point.sessions,
    engagedSessions: point.engagedSessions,
    clicks: point.clicks,
  }))
}

export function buildWebsiteConversionReport(input: {
  range: ConversionRange
  now?: Date
  ga4Rows: Ga4LandingRow[] | null
  gscRows: GscQueryRow[] | null
  leads: ConversionLeadRow[] | null
  events: ConversionTrackingRow[] | null
  syncRuns?: AnalyticsSyncRun[]
  ga4Latest?: { date: string | null; syncedAt: string | null }
  gscLatest?: { date: string | null; syncedAt: string | null }
}): WebsiteConversionReport {
  const now = input.now ?? new Date()
  const anchorDate = lastCompleteAnalyticsDay(now)
  const window = rangeWindow(input.range, anchorDate)
  const dates = eachIsoDate(window.start, window.end)
  const freshness = {
    ga4: syncFreshness(input.syncRuns ?? [], 'ga4'),
    gsc: syncFreshness(input.syncRuns ?? [], 'gsc'),
  }
  const ga4Status = sectionStatus(input.ga4Rows ? input.ga4Rows.length : null, freshness.ga4.coveredThrough, window.start)
  const gscStatus = sectionStatus(input.gscRows ? input.gscRows.length : null, freshness.gsc.coveredThrough, window.start)
  const leadsStatus = input.leads === null ? 'missing' : 'ready'
  const funnelStatus = input.events === null ? 'missing' : 'ready'

  const sourceTotals = Object.fromEntries(SOURCE_KEYS.map((key) => [key, { sessions: 0, engagedSessions: 0 }])) as Record<SourceKey, { sessions: number; engagedSessions: number }>
  const pageTotals = new Map<string, { sessions: number; engagedSessions: number }>()
  const ga4ByDate = new Map<string, { sessions: number; engagedSessions: number }>()
  let latestSyncedAt: string | null = input.ga4Latest?.syncedAt ?? null
  for (const row of input.ga4Rows ?? []) {
    const sessions = finite(row.sessions)
    const engaged = finite(row.engaged_sessions)
    const source = sourceTotals[bucketSessionSource(row.session_source_medium)]
    source.sessions += sessions
    source.engagedSessions += engaged
    const path = normalizeLandingPath(row.landing_page)
    const page = pageTotals.get(path) ?? { sessions: 0, engagedSessions: 0 }
    page.sessions += sessions
    page.engagedSessions += engaged
    pageTotals.set(path, page)
    const day = ga4ByDate.get(row.date) ?? { sessions: 0, engagedSessions: 0 }
    day.sessions += sessions
    day.engagedSessions += engaged
    ga4ByDate.set(row.date, day)
    if (row.synced_at && (!latestSyncedAt || row.synced_at > latestSyncedAt)) latestSyncedAt = row.synced_at
  }

  const gscByDate = new Map<string, { clicks: number; impressions: number }>()
  let clicks = 0
  let impressions = 0
  let weightedPosition = 0
  let positionWeight = 0
  let gscSyncedAt: string | null = input.gscLatest?.syncedAt ?? null
  for (const row of input.gscRows ?? []) {
    const rowClicks = finite(row.clicks)
    const rowImpressions = finite(row.impressions)
    clicks += rowClicks
    impressions += rowImpressions
    if (row.position != null && Number.isFinite(row.position) && rowImpressions > 0) {
      weightedPosition += row.position * rowImpressions
      positionWeight += rowImpressions
    }
    const day = gscByDate.get(row.date) ?? { clicks: 0, impressions: 0 }
    day.clicks += rowClicks
    day.impressions += rowImpressions
    gscByDate.set(row.date, day)
    if (row.synced_at && (!gscSyncedAt || row.synced_at > gscSyncedAt)) gscSyncedAt = row.synced_at
  }

  const pages = [...pageTotals.entries()].map(([path, totals]) => pageRow(path, totals.sessions, totals.engagedSessions))
  const landingPagesBySessions = [...pages].filter((page) => page.sessions > 0).sort((a, b) => b.sessions - a.sessions || b.engagedSessions - a.engagedSessions || a.path.localeCompare(b.path)).slice(0, 8)
  const landingPagesByEngaged = [...pages].filter((page) => page.engagedSessions > 0).sort((a, b) => b.engagedSessions - a.engagedSessions || b.sessions - a.sessions || a.path.localeCompare(b.path)).slice(0, 8)

  const sessionTotal = ga4Status === 'ready' ? [...ga4ByDate.values()].reduce((sum, day) => sum + day.sessions, 0) : null
  const engagedTotal = ga4Status === 'ready' ? [...ga4ByDate.values()].reduce((sum, day) => sum + day.engagedSessions, 0) : null
  let websiteForm: number | null = null
  let googleAdsPhone = 0
  let googleAdsTaxPhone = 0
  if (leadsStatus === 'ready') {
    websiteForm = 0
    for (const lead of input.leads ?? []) {
      if (lead.source === 'website_form') websiteForm += 1
      if (lead.source === 'google_ads_phone') googleAdsPhone += 1
      if (lead.source === 'google_ads_tax_phone') googleAdsTaxPhone += 1
    }
  }

  let landingEvents = 0
  let laterEvents = 0
  let unsessionedLandingEvents = 0
  let telClicks = 0
  const landingSessions = new Set<string>()
  const laterSessions = new Set<string>()
  if (funnelStatus === 'ready') {
    for (const event of input.events ?? []) {
      if (event.is_test) continue
      const name = event.event_name ?? ''
      if (EXCLUDED_EVENTS.has(name)) continue
      const sessionId = event.session_id?.trim() || ''
      if (PHONE_EVENTS.has(name)) telClicks += 1
      if (LANDING_EVENTS.has(name)) {
        landingEvents += 1
        if (sessionId) landingSessions.add(sessionId)
        else unsessionedLandingEvents += 1
      } else {
        laterEvents += 1
        if (sessionId) laterSessions.add(sessionId)
      }
    }
  }
  let sessionsWithLaterEvent = 0
  for (const sessionId of landingSessions) if (laterSessions.has(sessionId)) sessionsWithLaterEvent += 1

  const series = dates.map((date) => ({
    date,
    sessions: dayValue(ga4Status, freshness.ga4.coveredThrough, date, ga4ByDate.get(date)?.sessions),
    engagedSessions: dayValue(ga4Status, freshness.ga4.coveredThrough, date, ga4ByDate.get(date)?.engagedSessions),
    clicks: dayValue(gscStatus, freshness.gsc.coveredThrough, date, gscByDate.get(date)?.clicks),
    impressions: dayValue(gscStatus, freshness.gsc.coveredThrough, date, gscByDate.get(date)?.impressions),
  }))
  const sources = ga4Status === 'ready'
    ? SOURCE_KEYS.map((key) => {
      const totals = sourceTotals[key]
      return {
        key,
        label: SOURCE_LABELS[key],
        sessions: totals.sessions,
        engagedSessions: totals.engagedSessions,
        engagementRate: rate(totals.engagedSessions, totals.sessions),
        share: rate(totals.sessions, sessionTotal ?? 0),
      }
    })
    : []
  const phoneLeads = leadsStatus === 'ready' ? googleAdsPhone + googleAdsTaxPhone : null

  return {
    generatedAt: now.toISOString(),
    range: input.range,
    timeZone: CHICAGO_TIME_ZONE,
    anchorDate,
    window,
    freshness,
    ga4: {
      status: ga4Status,
      rowCount: input.ga4Rows?.length ?? 0,
      sessions: sessionTotal,
      engagedSessions: engagedTotal,
      engagementRate: sessionTotal == null ? null : rate(engagedTotal ?? 0, sessionTotal),
      daysWithRows: ga4ByDate.size,
      latestDate: input.ga4Latest?.date ?? null,
      latestSyncedAt,
    },
    gsc: {
      status: gscStatus,
      rowCount: input.gscRows?.length ?? 0,
      clicks: gscStatus === 'ready' ? clicks : null,
      impressions: gscStatus === 'ready' ? impressions : null,
      ctr: gscStatus === 'ready' ? rate(clicks, impressions) : null,
      averagePosition: gscStatus === 'ready' && positionWeight > 0 ? weightedPosition / positionWeight : null,
      daysWithRows: gscByDate.size,
      latestDate: input.gscLatest?.date ?? null,
      latestSyncedAt: gscSyncedAt,
      aggregation: GSC_AGGREGATION_NOTE,
    },
    sources,
    landingPagesBySessions: ga4Status === 'ready' ? landingPagesBySessions : [],
    landingPagesByEngaged: ga4Status === 'ready' ? landingPagesByEngaged : [],
    leads: {
      status: leadsStatus,
      websiteForm,
      googleAdsPhone: leadsStatus === 'ready' ? googleAdsPhone : null,
      googleAdsTaxPhone: leadsStatus === 'ready' ? googleAdsTaxPhone : null,
    },
    funnel: {
      status: funnelStatus,
      landingEvents: funnelStatus === 'ready' ? landingEvents : null,
      laterEvents: funnelStatus === 'ready' ? laterEvents : null,
      landingSessions: funnelStatus === 'ready' ? landingSessions.size : null,
      laterSessions: funnelStatus === 'ready' ? laterSessions.size : null,
      sessionsWithLaterEvent: funnelStatus === 'ready' ? sessionsWithLaterEvent : null,
      unsessionedLandingEvents: funnelStatus === 'ready' ? unsessionedLandingEvents : null,
    },
    rates: {
      sessionToForm: sessionTotal == null || websiteForm == null ? null : rate(websiteForm, sessionTotal),
      engagedToForm: engagedTotal == null || websiteForm == null ? null : rate(websiteForm, engagedTotal),
    },
    callIntent: {
      telClicks: funnelStatus === 'ready' ? telClicks : null,
      googleAdsPhoneLeads: phoneLeads,
      telStatus: funnelStatus,
      leadStatus: leadsStatus,
    },
    series,
    chart: chartPoints(series, input.range),
    suggestions: buildSuggestions({
      ga4Status,
      sessions: sessionTotal,
      pages,
      websiteForm,
      leadsStatus,
    }),
  }
}
