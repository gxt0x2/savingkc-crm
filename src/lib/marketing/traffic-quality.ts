export type TrafficQualitySeverity = 'low' | 'medium' | 'high'
export type TrafficQualityStatus = 'healthy' | 'watch' | 'suspicious'

export type TrafficQualityTrackingRow = {
  id?: string | null
  event_id?: string | null
  event_name?: string | null
  event_category?: string | null
  event_time?: string | null
  session_id?: string | null
  visitor_id?: string | null
  lead_id?: string | null
  page_path?: string | null
  page_location?: string | null
  page_referrer?: string | null
  traffic_source?: string | null
  campaign?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_term?: string | null
  utm_content?: string | null
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  form_step?: number | null
  form_status?: string | null
  phone_number?: string | null
  payload?: Record<string, unknown> | null
  created_at?: string | null
}

export type TrafficQualityIssue = {
  key: string
  label: string
  count: number
  severity: TrafficQualitySeverity
  detail: string
}

export type TrafficQualitySource = {
  key: string
  label: string
  sessions: number
  suspicious: number
  suspiciousRate: number
  noEngagement: number
  serverOnly: number
}

export type TrafficQualitySession = {
  id: string
  firstSeenAt: string | null
  lastSeenAt: string | null
  campaign: string
  source: string
  landingPage: string
  clickId: string
  device: string
  ipHashPrefix: string | null
  userAgentHashPrefix: string | null
  eventCount: number
  durationSec: number
  maxFormStep: number
  maxScrollDepth: number
  riskScore: number
  status: TrafficQualityStatus
  flags: string[]
  leadId: string | null
}

export type TrafficQualityReport = {
  status: TrafficQualityStatus
  score: number
  lastEvaluatedAt: string
  summary: {
    sessions: number
    suspiciousSessions: number
    watchSessions: number
    cleanSessions: number
    suspiciousRate: number
    serverLandingRequests: number
    serverOnlySessions: number
    noEngagementSessions: number
    shortVisitSessions: number
    repeatIpClusters: number
    repeatUaClusters: number
    botSessions: number
  }
  issues: TrafficQualityIssue[]
  sources: TrafficQualitySource[]
  sessions: TrafficQualitySession[]
  runSchedule: {
    capture: string
    analysis: string
    mode: string
  }
}

const ENGAGEMENT_EVENTS = new Set([
  'address_selected',
  'address_typed',
  'auction_status_selected',
  'condition_selected',
  'contact_field_started',
  'cta_click',
  'faq_opened',
  'form_error',
  'form_step_completed',
  'lead_quiz_qualified',
  'lead_quiz_started',
  'lead_submitted',
  'nav_click',
  'phone_click',
  'ppc_potential_lead_created',
  'scroll_depth_reached',
  'section_viewed',
  'show_me_clicked',
  'situation_selected',
  'skc_phone_number_selected',
  'step_3_field_completed',
  'timeline_selected',
  'video_completed',
  'video_paused',
  'video_started',
])

type SessionDraft = {
  rows: TrafficQualityTrackingRow[]
  ipHash: string | null
  uaHash: string | null
  firstMs: number
  lastMs: number
  serverLandingRequests: number
  hasClientVisit: boolean
  hasEngagement: boolean
  converted: boolean
  bot: boolean
  maxFormStep: number
  maxScrollDepth: number
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

function eventName(row: TrafficQualityTrackingRow): string {
  return text(row.event_name)
}

function eventTime(row: TrafficQualityTrackingRow): number {
  const time = Date.parse(text(row.event_time) || text(row.created_at))
  return Number.isFinite(time) ? time : 0
}

function payload(row: TrafficQualityTrackingRow): Record<string, unknown> {
  return record(row.payload)
}

function payloadAttribution(row: TrafficQualityTrackingRow): Record<string, unknown> {
  return record(payload(row).attribution)
}

function devicePayload(row: TrafficQualityTrackingRow): Record<string, unknown> {
  const body = payload(row)
  return record(body.device)
}

function clickId(row: TrafficQualityTrackingRow): string {
  const attribution = payloadAttribution(row)
  return text(row.gclid)
    || text(row.gbraid)
    || text(row.wbraid)
    || text(attribution.gclid)
    || text(attribution.gbraid)
    || text(attribution.wbraid)
    || text(attribution.oppref)
    || text(payload(row).click_id)
    || text(payload(row).oppref)
}

function sessionKey(row: TrafficQualityTrackingRow): string {
  return clickId(row)
    || text(row.session_id)
    || text(row.visitor_id)
    || text(row.event_id)
    || text(row.id)
}

function campaignName(rows: TrafficQualityTrackingRow[]): string {
  for (const row of rows) {
    const attribution = payloadAttribution(row)
    const campaign = text(row.campaign)
      || text(row.utm_campaign)
      || text(attribution.utm_campaign)
      || text(payload(row).campaign)
    if (campaign) return campaign
  }
  return 'Unmapped campaign'
}

function sourceName(rows: TrafficQualityTrackingRow[]): string {
  for (const row of rows) {
    const attribution = payloadAttribution(row)
    const source = text(row.traffic_source)
      || text(row.utm_source)
      || text(attribution.utm_source)
      || text(payload(row).traffic_source)
    if (source) return source
  }
  return 'unknown'
}

function landingPage(rows: TrafficQualityTrackingRow[]): string {
  for (const row of rows) {
    const value = text(row.page_path) || text(row.page_location) || text(payloadAttribution(row).landingUrl)
    if (value) {
      try {
        return new URL(value).pathname
      } catch {
        return value
      }
    }
  }
  return '--'
}

function deviceLabel(rows: TrafficQualityTrackingRow[]): string {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const device = devicePayload(rows[index]!)
    const platform = text(device.device_platform)
    const type = text(device.device_type)
    const label = [platform, type].filter(Boolean).join(' / ')
    if (label) return label
  }
  return '--'
}

function ipHash(row: TrafficQualityTrackingRow): string | null {
  return text(devicePayload(row).ip_hash) || text(payload(row).ip_hash) || null
}

function uaHash(row: TrafficQualityTrackingRow): string | null {
  return text(devicePayload(row).user_agent_hash) || text(payload(row).user_agent_hash) || null
}

function isBot(row: TrafficQualityTrackingRow): boolean {
  const device = devicePayload(row)
  return text(device.device_type).toLowerCase() === 'bot'
}

function isServerLanding(row: TrafficQualityTrackingRow): boolean {
  return eventName(row) === 'ppc_landing_request' || payload(row).server_side === true
}

function isClientVisit(row: TrafficQualityTrackingRow): boolean {
  return eventName(row) === 'ppc_visit_started' || eventName(row) === 'page_view'
}

function isConversion(row: TrafficQualityTrackingRow): boolean {
  const name = eventName(row)
  return Boolean(row.lead_id) || name === 'lead_submitted' || text(row.form_status).toLowerCase() === 'submitted'
}

function hasEngagement(row: TrafficQualityTrackingRow): boolean {
  const name = eventName(row)
  if (ENGAGEMENT_EVENTS.has(name)) return true
  return name.startsWith('video_progress_')
}

function scrollDepth(row: TrafficQualityTrackingRow): number {
  const body = payload(row)
  return Math.max(
    Number(body.depth) || 0,
    Number(body.scroll_depth) || 0,
    Number(body.percent) || 0,
  )
}

function addCount(map: Map<string, number>, key: string | null) {
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + 1)
}

function issue(key: string, label: string, count: number, severity: TrafficQualitySeverity, detail: string): TrafficQualityIssue | null {
  return count > 0 ? { key, label, count, severity, detail } : null
}

function riskStatus(score: number): TrafficQualityStatus {
  if (score >= 60) return 'suspicious'
  if (score >= 35) return 'watch'
  return 'healthy'
}

function buildSession(
  key: string,
  draft: SessionDraft,
  ipCounts: Map<string, number>,
  uaCounts: Map<string, number>,
): TrafficQualitySession {
  const ordered = [...draft.rows].sort((a, b) => eventTime(a) - eventTime(b))
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const durationSec = draft.firstMs && draft.lastMs ? Math.max(0, Math.round((draft.lastMs - draft.firstMs) / 1000)) : 0
  const serverOnly = draft.serverLandingRequests > 0 && !draft.hasClientVisit && ordered.length <= draft.serverLandingRequests
  const noEngagement = !draft.hasEngagement && !draft.converted
  const shortVisit = durationSec <= 6 && ordered.length <= 2 && !draft.converted
  const repeatIpCount = draft.ipHash ? ipCounts.get(draft.ipHash) ?? 0 : 0
  const repeatUaCount = draft.uaHash ? uaCounts.get(draft.uaHash) ?? 0 : 0
  const flags: string[] = []
  let riskScore = 0

  if (draft.bot) {
    flags.push('Bot-like user agent')
    riskScore += 45
  }
  if (serverOnly) {
    flags.push('Server landing only')
    riskScore += 35
  }
  if (noEngagement) {
    flags.push('No engagement')
    riskScore += 22
  }
  if (shortVisit) {
    flags.push('Very short visit')
    riskScore += 16
  }
  if (repeatIpCount >= 3 && !draft.converted) {
    flags.push(`Repeat IP hash x${repeatIpCount}`)
    riskScore += repeatIpCount >= 6 ? 28 : 20
  }
  if (repeatUaCount >= 8 && !draft.converted) {
    flags.push(`Repeat browser hash x${repeatUaCount}`)
    riskScore += 18
  }
  if (!draft.converted) {
    flags.push('No CRM lead')
    riskScore += 8
  }
  if (draft.converted) riskScore = Math.max(0, riskScore - 45)

  const boundedScore = Math.max(0, Math.min(100, riskScore))

  return {
    id: key,
    firstSeenAt: first ? new Date(eventTime(first)).toISOString() : null,
    lastSeenAt: last ? new Date(eventTime(last)).toISOString() : null,
    campaign: campaignName(ordered),
    source: sourceName(ordered),
    landingPage: landingPage(ordered),
    clickId: first ? clickId(first) || '--' : '--',
    device: deviceLabel(ordered),
    ipHashPrefix: draft.ipHash ? draft.ipHash.slice(0, 16) : null,
    userAgentHashPrefix: draft.uaHash ? draft.uaHash.slice(0, 16) : null,
    eventCount: ordered.length,
    durationSec,
    maxFormStep: draft.maxFormStep,
    maxScrollDepth: draft.maxScrollDepth,
    riskScore: boundedScore,
    status: riskStatus(boundedScore),
    flags,
    leadId: [...ordered].reverse().map((row) => text(row.lead_id)).find(Boolean) || null,
  }
}

export function buildTrafficQualityReport(
  rows: TrafficQualityTrackingRow[],
  options: { now?: string | Date } = {},
): TrafficQualityReport {
  const now = options.now instanceof Date ? options.now : options.now ? new Date(options.now) : new Date()
  const groups = new Map<string, SessionDraft>()

  for (const row of rows) {
    const key = sessionKey(row)
    if (!key) continue
    const ms = eventTime(row)
    const current = groups.get(key) ?? {
      rows: [],
      ipHash: null,
      uaHash: null,
      firstMs: ms,
      lastMs: ms,
      serverLandingRequests: 0,
      hasClientVisit: false,
      hasEngagement: false,
      converted: false,
      bot: false,
      maxFormStep: 0,
      maxScrollDepth: 0,
    }

    current.rows.push(row)
    current.ipHash = current.ipHash || ipHash(row)
    current.uaHash = current.uaHash || uaHash(row)
    current.firstMs = current.firstMs && ms ? Math.min(current.firstMs, ms) : ms || current.firstMs
    current.lastMs = current.lastMs && ms ? Math.max(current.lastMs, ms) : ms || current.lastMs
    current.serverLandingRequests += isServerLanding(row) ? 1 : 0
    current.hasClientVisit = current.hasClientVisit || isClientVisit(row)
    current.hasEngagement = current.hasEngagement || hasEngagement(row)
    current.converted = current.converted || isConversion(row)
    current.bot = current.bot || isBot(row)
    current.maxFormStep = Math.max(current.maxFormStep, row.form_step ?? 0)
    current.maxScrollDepth = Math.max(current.maxScrollDepth, scrollDepth(row))
    groups.set(key, current)
  }

  const ipCounts = new Map<string, number>()
  const uaCounts = new Map<string, number>()
  for (const draft of groups.values()) {
    addCount(ipCounts, draft.ipHash)
    addCount(uaCounts, draft.uaHash)
  }

  const sessions = Array.from(groups.entries())
    .map(([key, draft]) => buildSession(key, draft, ipCounts, uaCounts))
    .sort((a, b) => b.riskScore - a.riskScore || Date.parse(b.lastSeenAt ?? '') - Date.parse(a.lastSeenAt ?? ''))

  const suspiciousSessions = sessions.filter((session) => session.status === 'suspicious').length
  const watchSessions = sessions.filter((session) => session.status === 'watch').length
  const serverLandingRequests = Array.from(groups.values()).reduce((sum, draft) => sum + draft.serverLandingRequests, 0)
  const serverOnlySessions = sessions.filter((session) => session.flags.includes('Server landing only')).length
  const noEngagementSessions = sessions.filter((session) => session.flags.includes('No engagement')).length
  const shortVisitSessions = sessions.filter((session) => session.flags.includes('Very short visit')).length
  const repeatIpClusters = Array.from(ipCounts.values()).filter((count) => count >= 3).length
  const repeatUaClusters = Array.from(uaCounts.values()).filter((count) => count >= 8).length
  const botSessions = sessions.filter((session) => session.flags.includes('Bot-like user agent')).length
  const suspiciousRate = pct(suspiciousSessions + watchSessions, sessions.length)
  const score = Math.max(0, Math.min(100, Math.round(100 - suspiciousRate)))
  const status: TrafficQualityStatus = suspiciousSessions > 0 || suspiciousRate >= 25
    ? 'suspicious'
    : watchSessions > 0 || suspiciousRate >= 10
      ? 'watch'
      : 'healthy'

  const issues = [
    issue('server_only', 'Server-only landings', serverOnlySessions, 'high', 'The landing request arrived, but no browser-side tracking followed. Watch this for blocked JS, bots, or very fast bounces.'),
    issue('no_engagement', 'No engagement sessions', noEngagementSessions, noEngagementSessions >= 5 ? 'medium' : 'low', 'Ad sessions with no scroll, CTA, phone, video, FAQ, or form interaction.'),
    issue('short_visits', 'Very short visits', shortVisitSessions, 'medium', 'Sessions that ended in six seconds or less with one or two events.'),
    issue('repeat_ip', 'Repeat IP hash clusters', repeatIpClusters, 'high', 'Three or more ad sessions share the same hashed IP in the selected period.'),
    issue('repeat_ua', 'Repeat browser clusters', repeatUaClusters, 'medium', 'Eight or more ad sessions share the same hashed browser signature.'),
    issue('bot_ua', 'Bot-like user agents', botSessions, 'high', 'Requests where the device classifier saw bot, crawler, spider, or preview signatures.'),
  ].filter((row): row is TrafficQualityIssue => Boolean(row))

  const bySource = new Map<string, TrafficQualitySource>()
  for (const session of sessions) {
    const key = `${session.source}|${session.campaign}`
    const current = bySource.get(key) ?? {
      key,
      label: `${session.source} / ${session.campaign}`,
      sessions: 0,
      suspicious: 0,
      suspiciousRate: 0,
      noEngagement: 0,
      serverOnly: 0,
    }
    current.sessions += 1
    if (session.status !== 'healthy') current.suspicious += 1
    if (session.flags.includes('No engagement')) current.noEngagement += 1
    if (session.flags.includes('Server landing only')) current.serverOnly += 1
    current.suspiciousRate = pct(current.suspicious, current.sessions)
    bySource.set(key, current)
  }

  return {
    status,
    score,
    lastEvaluatedAt: Number.isNaN(now.getTime()) ? new Date().toISOString() : now.toISOString(),
    summary: {
      sessions: sessions.length,
      suspiciousSessions,
      watchSessions,
      cleanSessions: sessions.filter((session) => session.status === 'healthy').length,
      suspiciousRate,
      serverLandingRequests,
      serverOnlySessions,
      noEngagementSessions,
      shortVisitSessions,
      repeatIpClusters,
      repeatUaClusters,
      botSessions,
    },
    issues,
    sources: Array.from(bySource.values())
      .sort((a, b) => b.suspiciousRate - a.suspiciousRate || b.sessions - a.sessions)
      .slice(0, 8),
    sessions: sessions.slice(0, 12),
    runSchedule: {
      capture: 'Every /ppc and /ppc-tax page request, before browser JavaScript; browser events stream as the visitor acts.',
      analysis: 'Recomputed when /marketing loads and every 60 seconds while the dashboard is open.',
      mode: 'Monitor-only. No visitor blocking or Google Ads IP exclusion is automated.',
    },
  }
}

export const EMPTY_TRAFFIC_QUALITY_REPORT: TrafficQualityReport = buildTrafficQualityReport([], {
  now: '2026-01-01T00:00:00.000Z',
})
