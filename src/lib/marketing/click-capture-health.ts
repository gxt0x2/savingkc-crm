import { paidSourceIdentifier, paidSourceKey, type PaidSourceKey } from '@/lib/marketing/paid-source'

export type ClickCaptureStatus = 'clean' | 'watch' | 'attention'

export type ClickCaptureStageKey =
  | 'platform_clicks'
  | 'server_landings'
  | 'browser_sessions'
  | 'form_starts'
  | 'step_progress'
  | 'crm_leads'
  | 'exported_conversions'

export type ClickCaptureStage = {
  key: ClickCaptureStageKey
  label: string
  value: number
  previousRate: number | null
  note: string
}

export type ClickCaptureSourceHealth = {
  source: PaidSourceKey | 'all'
  label: string
  status: ClickCaptureStatus
  message: string
  platformClicks: number
  serverLandings: number
  browserSessions: number
  formStarts: number
  stepProgress: number
  crmLeads: number
  exportedConversions: number
  pendingExports: number
  failedExports: number
  gaps: {
    platformToServer: number
    serverToBrowser: number
    browserToForm: number
    formToLead: number
    leadToExport: number
  }
  stages: ClickCaptureStage[]
}

export type ClickCaptureHealth = {
  generatedAt: string
  status: ClickCaptureStatus
  message: string
  totals: ClickCaptureSourceHealth
  sources: ClickCaptureSourceHealth[]
}

export type CaptureCampaignRow = {
  campaign_name?: string | null
  paid_source?: PaidSourceKey | null
  clicks?: number | string | null
}

export type CaptureTrackingRow = {
  id?: string | null
  event_id?: string | null
  event_name?: string | null
  event_category?: string | null
  session_id?: string | null
  visitor_id?: string | null
  lead_id?: string | null
  page_location?: string | null
  page_referrer?: string | null
  traffic_source?: string | null
  campaign?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  form_step?: number | null
  form_status?: string | null
  payload?: Record<string, unknown> | null
}

export type CaptureLeadRow = {
  id?: string | number | null
  source?: string | null
}

export type CaptureOutboxRow = {
  id?: string | null
  event_name?: string | null
  event_category?: string | null
  status?: string | null
  lead_id?: string | null
  attribution?: Record<string, unknown> | null
  payload?: Record<string, unknown> | null
}

export type BuildClickCaptureHealthInput = {
  campaignRows: CaptureCampaignRow[]
  trackingRows: CaptureTrackingRow[]
  leadRows: CaptureLeadRow[]
  outboxRows: CaptureOutboxRow[]
  generatedAt?: string
}

const SOURCE_LABELS: Record<PaidSourceKey, string> = {
  google_ads: 'Google Ads',
  openai_ads: 'OpenAI Ads',
}

const SOURCE_KEYS: PaidSourceKey[] = ['google_ads', 'openai_ads']

export const EMPTY_CLICK_CAPTURE_HEALTH: ClickCaptureHealth = {
  generatedAt: '',
  status: 'clean',
  message: 'No paid capture data loaded yet.',
  totals: emptySourceHealth('all'),
  sources: [emptySourceHealth('google_ads'), emptySourceHealth('openai_ads')],
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function integer(value: unknown): number {
  return Math.max(0, Math.round(numberValue(value)))
}

function sourceLabel(source: PaidSourceKey | 'all'): string {
  return source === 'all' ? 'All Paid' : SOURCE_LABELS[source]
}

function trackingAttribution(row: CaptureTrackingRow): Record<string, unknown> {
  const payload = record(row.payload)
  const attribution = record(payload.attribution)
  return {
    ...attribution,
    traffic_source: row.traffic_source || attribution.traffic_source,
    source: row.utm_source || row.traffic_source || attribution.source,
    medium: row.utm_medium || attribution.medium,
    campaign: row.campaign || row.utm_campaign || attribution.campaign,
    utm_campaign: row.utm_campaign || attribution.utm_campaign,
    gclid: row.gclid || attribution.gclid || payload.gclid,
    gbraid: row.gbraid || attribution.gbraid || payload.gbraid,
    wbraid: row.wbraid || attribution.wbraid || payload.wbraid,
    oppref: attribution.oppref || payload.oppref,
    skc_openai_click_id: attribution.skc_openai_click_id || payload.skc_openai_click_id,
    landingUrl: row.page_location || attribution.landingUrl || payload.landingUrl,
    source_url: row.page_location || attribution.source_url || payload.source_url,
    referrer: row.page_referrer || attribution.referrer || payload.referrer,
  }
}

function trackingSource(row: CaptureTrackingRow): PaidSourceKey {
  return paidSourceKey(trackingAttribution(row))
}

function campaignSource(row: CaptureCampaignRow): PaidSourceKey {
  if (row.paid_source === 'openai_ads') return 'openai_ads'
  if (row.paid_source === 'google_ads') return 'google_ads'
  return /openai|chatgpt/i.test(text(row.campaign_name)) ? 'openai_ads' : 'google_ads'
}

function leadSource(row: CaptureLeadRow): PaidSourceKey {
  return /openai|chatgpt/i.test(text(row.source)) ? 'openai_ads' : 'google_ads'
}

function outboxSource(row: CaptureOutboxRow): PaidSourceKey {
  return paidSourceKey({
    ...record(row.attribution),
    ...record(row.payload),
  })
}

function sessionKey(row: CaptureTrackingRow): string {
  const attribution = trackingAttribution(row)
  return text(row.session_id) ||
    text(row.visitor_id) ||
    paidSourceIdentifier(attribution) ||
    text(row.event_id) ||
    text(row.id)
}

function isServerLanding(row: CaptureTrackingRow): boolean {
  const eventName = text(row.event_name)
  const payload = record(row.payload)
  return eventName === 'ppc_landing_request' || payload.server_side === true || payload.serverSide === true
}

function isBrowserSessionSignal(row: CaptureTrackingRow): boolean {
  if (isServerLanding(row)) return false
  const eventName = text(row.event_name)
  return Boolean(
    eventName === 'ppc_visit_started' ||
      eventName === 'page_view' ||
      eventName === 'page_viewed' ||
      eventName === 'lead_quiz_started' ||
      eventName === 'situation_selected' ||
      eventName === 'timeline_selected' ||
      eventName === 'condition_selected' ||
      eventName === 'address_selected' ||
      eventName === 'address_typed' ||
      eventName === 'contact_field_started' ||
      eventName === 'lead_submitted' ||
      row.form_step ||
      row.lead_id,
  )
}

function isFormStart(row: CaptureTrackingRow): boolean {
  const eventName = text(row.event_name)
  return Boolean(
    eventName === 'lead_quiz_started' ||
      eventName === 'situation_selected' ||
      eventName === 'timeline_selected' ||
      eventName === 'condition_selected' ||
      eventName === 'auction_status_selected' ||
      eventName === 'form_step_completed' ||
      eventName === 'step_3_field_completed' ||
      eventName === 'lead_stage3_completed' ||
      eventName === 'address_selected' ||
      eventName === 'address_typed' ||
      eventName === 'contact_field_started' ||
      eventName === 'lead_submitted' ||
      (row.form_step ?? 0) >= 1,
  )
}

function isStepProgress(row: CaptureTrackingRow): boolean {
  const eventName = text(row.event_name)
  return Boolean(
    eventName === 'timeline_selected' ||
      eventName === 'condition_selected' ||
      eventName === 'auction_status_selected' ||
      eventName === 'form_step_completed' ||
      eventName === 'step_3_field_completed' ||
      eventName === 'lead_stage3_completed' ||
      eventName === 'lead_quiz_qualified' ||
      eventName === 'address_selected' ||
      eventName === 'address_typed' ||
      eventName === 'contact_field_started' ||
      eventName === 'lead_submitted' ||
      text(row.form_status) === 'submitted' ||
      (row.form_step ?? 0) >= 2,
  )
}

function addIfPresent(set: Set<string>, value: unknown): void {
  const key = text(value)
  if (key) set.add(key)
}

function stage(
  key: ClickCaptureStageKey,
  label: string,
  value: number,
  previous: number | null,
  note: string,
): ClickCaptureStage {
  return {
    key,
    label,
    value,
    previousRate: previous && previous > 0 ? Math.round((value / previous) * 1000) / 10 : null,
    note,
  }
}

function statusRank(status: ClickCaptureStatus): number {
  if (status === 'attention') return 2
  if (status === 'watch') return 1
  return 0
}

function emptySourceHealth(source: PaidSourceKey | 'all'): ClickCaptureSourceHealth {
  return buildSourceHealth(source, {
    platformClicks: 0,
    serverLandings: 0,
    browserSessions: 0,
    formStarts: 0,
    stepProgress: 0,
    crmLeads: 0,
    exportedConversions: 0,
    pendingExports: 0,
    failedExports: 0,
  })
}

function buildSourceHealth(
  source: PaidSourceKey | 'all',
  counts: Omit<ClickCaptureSourceHealth, 'source' | 'label' | 'status' | 'message' | 'gaps' | 'stages'>,
): ClickCaptureSourceHealth {
  const gaps = {
    platformToServer: Math.max(0, counts.platformClicks - counts.serverLandings),
    serverToBrowser: Math.max(0, counts.serverLandings - counts.browserSessions),
    browserToForm: Math.max(0, counts.browserSessions - counts.formStarts),
    formToLead: Math.max(0, counts.formStarts - counts.crmLeads),
    leadToExport: Math.max(0, counts.crmLeads - counts.exportedConversions),
  }

  let status: ClickCaptureStatus = 'clean'
  let message = 'Capture path is connected for this source.'

  if (counts.platformClicks === 0 && counts.serverLandings === 0 && counts.browserSessions === 0 && counts.crmLeads === 0) {
    status = 'clean'
    message = 'No paid clicks are in this period yet.'
  } else if (counts.platformClicks > 0 && counts.serverLandings === 0) {
    status = 'attention'
    message = 'Ad-platform clicks are imported, but no matching landing request reached CRM.'
  } else if (counts.failedExports > 0) {
    status = 'attention'
    message = 'One or more conversion exports failed and need review.'
  } else if (gaps.platformToServer > 0) {
    status = 'watch'
    message = 'Some platform clicks do not yet have a server-side landing request.'
  } else if (gaps.serverToBrowser > 0) {
    status = 'watch'
    message = 'Server saw the landing, but browser journey replay is missing for some sessions.'
  } else if (gaps.browserToForm > 0) {
    status = 'watch'
    message = 'Visitors reached the page but did not start the form.'
  } else if (counts.pendingExports > 0 || gaps.leadToExport > 0) {
    status = 'watch'
    message = 'CRM lead capture works, but conversion export feedback is still pending.'
  }

  return {
    source,
    label: sourceLabel(source),
    status,
    message,
    ...counts,
    gaps,
    stages: [
      stage('platform_clicks', 'Platform clicks', counts.platformClicks, null, 'Imported from the ad platform.'),
      stage('server_landings', 'Server landings', counts.serverLandings, counts.platformClicks, 'Captured before browser JavaScript.'),
      stage('browser_sessions', 'Browser sessions', counts.browserSessions, counts.serverLandings, 'Replayable on-site journey rows.'),
      stage('form_starts', 'Form starts', counts.formStarts, counts.browserSessions, 'Visitor began the seller intake.'),
      stage('step_progress', 'Step progress', counts.stepProgress, counts.formStarts, 'Visitor moved beyond the first answer.'),
      stage('crm_leads', 'CRM leads', counts.crmLeads, counts.formStarts, 'Lead record or lead-linked event exists.'),
      stage('exported_conversions', 'Export sent', counts.exportedConversions, counts.crmLeads, 'Conversion feedback marked sent.'),
    ],
  }
}

function sourceCounts(
  source: PaidSourceKey,
  input: BuildClickCaptureHealthInput,
): Omit<ClickCaptureSourceHealth, 'source' | 'label' | 'status' | 'message' | 'gaps' | 'stages'> {
  const trackingRows = input.trackingRows.filter((row) => trackingSource(row) === source)
  const outboxRows = input.outboxRows.filter((row) => outboxSource(row) === source)
  const leadRows = input.leadRows.filter((row) => leadSource(row) === source)
  const serverLandingSessions = new Set<string>()
  const browserSessions = new Set<string>()
  const formStartSessions = new Set<string>()
  const stepProgressSessions = new Set<string>()
  const leadIds = new Set<string>()

  for (const row of trackingRows) {
    const key = sessionKey(row)
    if (!key) continue
    if (isServerLanding(row)) serverLandingSessions.add(key)
    if (isBrowserSessionSignal(row)) browserSessions.add(key)
    if (isFormStart(row)) formStartSessions.add(key)
    if (isStepProgress(row)) stepProgressSessions.add(key)
    addIfPresent(leadIds, row.lead_id)
  }

  for (const row of leadRows) addIfPresent(leadIds, row.id)
  for (const row of outboxRows) addIfPresent(leadIds, row.lead_id)

  return {
    platformClicks: input.campaignRows
      .filter((row) => campaignSource(row) === source)
      .reduce((sum, row) => sum + integer(row.clicks), 0),
    serverLandings: serverLandingSessions.size,
    browserSessions: browserSessions.size,
    formStarts: formStartSessions.size,
    stepProgress: stepProgressSessions.size,
    crmLeads: leadIds.size,
    exportedConversions: outboxRows.filter((row) => text(row.status).toLowerCase() === 'sent').length,
    pendingExports: outboxRows.filter((row) => ['pending', 'processing'].includes(text(row.status).toLowerCase())).length,
    failedExports: outboxRows.filter((row) => /failed|dead/i.test(text(row.status))).length,
  }
}

function totalCounts(sources: ClickCaptureSourceHealth[]): Omit<ClickCaptureSourceHealth, 'source' | 'label' | 'status' | 'message' | 'gaps' | 'stages'> {
  return sources.reduce((acc, source) => {
    acc.platformClicks += source.platformClicks
    acc.serverLandings += source.serverLandings
    acc.browserSessions += source.browserSessions
    acc.formStarts += source.formStarts
    acc.stepProgress += source.stepProgress
    acc.crmLeads += source.crmLeads
    acc.exportedConversions += source.exportedConversions
    acc.pendingExports += source.pendingExports
    acc.failedExports += source.failedExports
    return acc
  }, {
    platformClicks: 0,
    serverLandings: 0,
    browserSessions: 0,
    formStarts: 0,
    stepProgress: 0,
    crmLeads: 0,
    exportedConversions: 0,
    pendingExports: 0,
    failedExports: 0,
  })
}

function hasSourceData(source: ClickCaptureSourceHealth): boolean {
  return source.platformClicks > 0 ||
    source.serverLandings > 0 ||
    source.browserSessions > 0 ||
    source.formStarts > 0 ||
    source.crmLeads > 0 ||
    source.exportedConversions > 0 ||
    source.pendingExports > 0 ||
    source.failedExports > 0
}

export function buildClickCaptureHealth(input: BuildClickCaptureHealthInput): ClickCaptureHealth {
  const sourceRows = SOURCE_KEYS
    .map((source) => buildSourceHealth(source, sourceCounts(source, input)))
    .filter(hasSourceData)
  const sources = sourceRows.length > 0 ? sourceRows : SOURCE_KEYS.map((source) => emptySourceHealth(source))
  const totals = buildSourceHealth('all', totalCounts(sourceRows))
  const worst = [totals, ...sourceRows].sort((a, b) => statusRank(b.status) - statusRank(a.status))[0] ?? totals

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: worst.status,
    message: worst.status === 'clean'
      ? 'Paid click capture is connected for the selected period.'
      : worst.message,
    totals,
    sources,
  }
}
