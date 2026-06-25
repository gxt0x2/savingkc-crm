import { isPpcTrackingNumber } from '@/lib/call-quality-events'
import { isKnownPpcCampaignName, ppcCampaignNameForContext } from '@/lib/ppc/campaigns'
import {
  conversionDeadline,
  defaultGoogleAdsQualityScore,
  resolveGoogleAdsQualityScore,
  type ConversionDeadlineStatus,
  type GoogleAdsQualityScore,
} from '@/lib/ppc/conversion-approval'
import { isGoogleAdsApprovalRequiredPpcEvent, isGoogleAdsExportablePpcEvent } from '@/lib/ppc/exportable-events'
import type { PpcConversionExportConfigHealth } from '@/lib/ppc/conversion-exporter'
import { paidSourceIdentifier, paidSourceIdentifierType, paidSourceSlug } from './paid-source'

export type PpcLeadRow = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  source: string | null
  station: string | null
  priority: string | null
  property_address: string | null
  city: string | null
  created_at: string | null
  updated_at: string | null
  classification?: string | null
  opportunity_score?: number | null
}

export type PpcActivityRow = {
  id: string
  lead_id: string | null
  activity_type: string | null
  type?: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
  agent?: string | null
}

export type PpcOutboxRow = {
  id: string
  event_name: string | null
  event_category: string | null
  dedupe_key?: string | null
  status: string | null
  approved_for_google_ads?: boolean | null
  optimization_role: string | null
  lead_id: string | null
  conversion_value: number | string | null
  event_time: string | null
  click_id: string | null
  click_id_type: string | null
  attribution: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  attempts: number | null
  last_error: string | null
  sent_at: string | null
  approved_at?: string | null
  approved_by?: string | null
  approval_note?: string | null
  created_at: string | null
}

export type PpcAppointmentRow = {
  id: string
  lead_id: string | null
  scheduled_at: string | null
  status: string | null
  source: string | null
  created_at: string | null
}

export type PpcRevenueRow = {
  id: string
  deal_id: string | null
  amount: number | string | null
  date: string | null
  source: string | null
}

export type PpcManifestRow = {
  lead_id: string | null
  manifest: Record<string, unknown> | null
  created_at: string | null
}

export type PpcTrackingEventRow = {
  id: string
  event_id: string | null
  event_name: string | null
  event_category: string | null
  event_time: string | null
  session_id: string | null
  visitor_id: string | null
  lead_id: string | null
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
  gad_source?: string | null
  gad_campaignid?: string | null
  gad_adgroupid?: string | null
  form_step: number | null
  form_status: string | null
  situation_raw: string | null
  timeline_raw: string | null
  condition_raw: string | null
  phone_number: string | null
  sms_consent: boolean | null
  is_test: boolean | null
  attribution?: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  created_at: string | null
}

export type PpcMissedCallTaskRow = {
  id: string
  lead_id: string | null
  created_at: string | null
  metadata: Record<string, unknown> | null
}

export type PpcReportInput = {
  days: number
  since: string
  until: string
  leads: PpcLeadRow[]
  activities: PpcActivityRow[]
  outbox: PpcOutboxRow[]
  trackingEvents: PpcTrackingEventRow[]
  appointments: PpcAppointmentRow[]
  revenue: PpcRevenueRow[]
  manifests: PpcManifestRow[]
  missedCallTasks?: PpcMissedCallTaskRow[]
  exportConfig?: PpcConversionExportConfigHealth
  now?: string | Date
}

export type PpcReport = {
  generatedAt: string
  period: {
    days: number
    since: string
    until: string
  }
  summary: {
    paidVisits: number
    eventLogTotal: number
    optionSelections: number
    step1Completions: number
    step2Completions: number
    phoneClicks: number
    consentedSubmits: number
    testRecords: number
    totalLeads: number
    formSubmits: number
    stage3NoSubmit: number
    callLeads: number
    connectedCalls: number
    call60s: number
    call2m: number
    call5m: number
    qualified: number
    appointments: number
    contracts: number
    revenue: number
    clickIdCoverageRate: number
    submitRate: number
    appointmentRate: number
    contractRate: number
  }
  funnel: Array<{
    key: string
    label: string
    count: number
    rateFromPrevious: number | null
    rateFromLead: number | null
  }>
  callQuality: Array<{
    key: string
    label: string
    count: number
    shareOfConnected: number | null
  }>
  attributionRows: Array<{
    key: string
    source: string
    medium: string
    campaign: string
    campaignId: string
    adGroupId: string
    keyword: string
    content: string
    leads: number
    formSubmits: number
    stage3NoSubmit: number
    callLeads: number
    appointments: number
    contracts: number
    revenue: number
    clickIds: number
  }>
  exportHealth: {
    total: number
    primary: number
    secondary: number
    pending: number
    sent: number
    failed: number
    deadLetter: number
    skipped: number
    awaitingApproval: number
    approvedPending: number
  }
  conversionApproval: {
    awaitingApproval: number
    approvedPending: number
    review: number
    urgent: number
    critical: number
    expired: number
    score1: number
    score2: number
    score3: number
  }
  conversionApprovalQueue: Array<{
    id: string
    eventName: string
    eventLabel: string
    category: string
    role: string
    status: string
    leadId: string | null
    leadName: string
    leadPhone: string
    leadAddress: string
    campaign: string
    clickId: string
    clickIdType: string
    eventTime: string | null
    expiresAt: string | null
    ageDays: number | null
    daysLeft: number | null
    deadlineStatus: ConversionDeadlineStatus
    qualityScore: GoogleAdsQualityScore | null
    suggestedQualityScore: GoogleAdsQualityScore
    attempts: number
    lastError: string
    approvedAt: string | null
    approvedBy: string
    approvalNote: string
  }>
  dataQuality: {
    clickIdCoverage: number
    attributionCoverage: number
    sourceMediumCoverage: number
    gclidRows: number
    gbraidRows: number
    wbraidRows: number
    missingClickIdRows: number
    pendingExports: number
    failedExports: number
  }
  operationsHealth: {
    ppcExportWorker: {
      path: string
      schedule: string
      status: 'healthy' | 'attention' | 'blocked'
      readyToExport: number
      pending: number
      awaitingApproval: number
      failed: number
      deadLetter: number
      oldestReadyAt: string | null
      oldestReadyAgeHours: number | null
      lastSentAt: string | null
    }
    googleAdsMissedCalls: {
      path: string
      schedule: string
      status: 'healthy' | 'attention' | 'blocked'
      pendingEscalations: number
      overdueEscalations: number
      oldestDueAt: string | null
      oldestDueAgeMinutes: number | null
    }
  }
  exportConfig: PpcConversionExportConfigHealth
  daily: Array<{
    date: string
    leads: number
    visits: number
    formSubmits: number
    ppcCalls: number
    phoneClicks: number
    appointments: number
  }>
  recentSessions: Array<{
    key: string
    firstEventAt: string | null
    lastEventAt: string | null
    eventCount: number
    status: 'visit_only' | 'phone_click' | 'engaged' | 'reached_step_3' | 'address_only' | 'potential' | 'step_3_no_submit' | 'submitted'
    maxStep: number
    lastEvent: string
    campaign: string
    source: string
    medium: string
    clickId: string
    device: string
    situation: string
    timeline: string
    condition: string
    addressSignal: string
    leadId: string | null
  }>
  journeySessions: Array<{
    key: string
    firstEventAt: string | null
    lastEventAt: string | null
    eventCount: number
    campaign: string
    source: string
    medium: string
    clickId: string
    device: string
    leadId: string | null
    leadName: string
    choices: {
      situation: string
      timeline: string
      condition: string
      address: string
    }
    steps: Array<{
      key: string
      label: string
      status: 'complete' | 'active' | 'missing'
      detail: string
      at: string | null
    }>
  }>
  recentLeads: Array<{
    id: string
    name: string
    phone: string
    address: string
    stage: string
    createdAt: string | null
    lastSignalAt: string | null
    lastSignal: string
    formStatus: 'submitted' | 'stage_3_no_submit' | 'potential_no_submit' | 'call_only' | 'lead_only'
    campaign: string
    keyword: string
    clickId: string
    callQuality: string
    revenue: number
  }>
  resultCounts: {
    journeySessionsShown: number
    journeySessionsTotal: number
    journeySessionsHiddenNoClickId: number
    recentSessionsShown: number
    recentSessionsTotal: number
    recentLeadsShown: number
    recentLeadsTotal: number
    attributionRowsShown: number
    attributionRowsTotal: number
  }
}

type LeadState = {
  lead: PpcLeadRow
  attribution: Record<string, unknown>
  formSubmitted: boolean
  stage3Complete: boolean
  potentialNoSubmit: boolean
  hasPpcCall: boolean
  connectedCallIds: Set<string>
  milestone60s: Set<string>
  milestone2m: Set<string>
  milestone5m: Set<string>
  appointmentIds: Set<string>
  revenue: number
  latestSignalAt: string | null
  latestSignal: string
}

const QUALIFIED_STAGES = new Set(['qualified', 'appointment_set', 'offer_made', 'under_contract', 'closed_won', 'contract_signed', 'closed'])
const CONTRACT_STAGES = new Set(['under_contract', 'closed_won', 'contract_signed', 'closed'])
const APPOINTMENT_STAGES = new Set(['appointment_set', 'offer_made', 'under_contract', 'closed_won', 'contract_signed', 'closed'])
const JOURNEY_SESSION_LIMIT = 12
const RECENT_SESSION_LIMIT = 25
const RECENT_LEAD_LIMIT = 25
const ATTRIBUTION_ROW_LIMIT = 25

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function money(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function olderIso(current: string | null, next: string | null | undefined): string | null {
  const nextDate = validDate(next)
  if (!nextDate) return current
  const currentDate = validDate(current)
  return !currentDate || nextDate.getTime() < currentDate.getTime() ? nextDate.toISOString() : current
}

function newerIso(current: string | null, next: string | null | undefined): string | null {
  const nextDate = validDate(next)
  if (!nextDate) return current
  const currentDate = validDate(current)
  return !currentDate || nextDate.getTime() > currentDate.getTime() ? nextDate.toISOString() : current
}

function ageHours(value: string | null, now: Date): number | null {
  const date = validDate(value)
  if (!date || Number.isNaN(now.getTime())) return null
  return Math.max(0, Math.round(((now.getTime() - date.getTime()) / 3_600_000) * 10) / 10)
}

function ageMinutes(value: string | null, now: Date): number | null {
  const date = validDate(value)
  if (!date || Number.isNaN(now.getTime())) return null
  return Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000))
}

function normalizeStage(stage: string | null | undefined): string {
  const value = text(stage).toLowerCase()
  if (!value || value === 'not_contacted') return 'new'
  if (value === 'appt_set' || value === 'appointment') return 'appointment_set'
  if (value === 'contract' || value === 'contract_signed' || value === 'in_closing') return 'under_contract'
  if (value === 'closed') return 'closed_won'
  return value
}

function metadata(activity: PpcActivityRow): Record<string, unknown> {
  return record(activity.metadata)
}

function activityId(activity: PpcActivityRow): string {
  const meta = metadata(activity)
  return text(meta.dialCallSid) || text(meta.callSid) || text(meta.dedupeKey) || activity.id
}

function milestoneKey(event: string, raw: string): string {
  const parts = raw.split(':').filter(Boolean)
  if (parts.length >= 3 && parts[0] === 'call') return `${event}:${parts[1]}`
  return `${event}:${raw}`
}

function outboxId(row: PpcOutboxRow): string {
  return text(row.dedupe_key) || row.id
}

function activityEvent(activity: PpcActivityRow): string {
  const meta = metadata(activity)
  return text(meta.event) || text(meta.event_name)
}

function digits(value: unknown): string {
  return text(value).replace(/\D/g, '')
}

function isPpcNumber(value: unknown): boolean {
  return isPpcTrackingNumber(text(value))
}

function isPpcActivity(activity: PpcActivityRow): boolean {
  const meta = metadata(activity)
  return (
    text(meta.traffic_source) === 'google_ads' ||
    isKnownPpcCampaignName(meta.campaign) ||
    isPpcNumber(meta.tracking_number) ||
    isPpcNumber(meta.calledNumber) ||
    isPpcNumber(meta.to)
  )
}

function isConnectedCall(activity: PpcActivityRow): boolean {
  const meta = metadata(activity)
  const type = text(activity.activity_type || activity.type).toLowerCase()
  const outcome = text(meta.outcome).toLowerCase()
  const status = text(meta.status || meta.dialStatus).toLowerCase()
  return type === 'call' && (outcome === 'connected' || status === 'completed' || status === 'answered')
}

function isFormSubmit(activity: PpcActivityRow): boolean {
  const meta = metadata(activity)
  return (
    text(meta.source) === 'ppc_form_submit' ||
    text(meta.form_status) === 'submitted' ||
    text(activity.description).toLowerCase() === 'ppc form submitted.'
  )
}

function isStage3Complete(activity: PpcActivityRow): boolean {
  const meta = metadata(activity)
  return (
    text(meta.source) === 'ppc_form_autosave' ||
    text(meta.form_status) === 'stage_3_complete_no_submit'
  )
}

function isPotentialNoSubmit(activity: PpcActivityRow): boolean {
  const meta = metadata(activity)
  return (
    text(meta.source) === 'ppc_form_potential' ||
    text(meta.form_status) === 'potential_no_submit'
  )
}

function latestAt(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

function compactDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function getNested(input: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = input
  for (const part of path) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

function extractAttributionFromManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const acquisitionAttribution = record(getNested(manifest, ['acquisition', 'attribution']))
  const acquisition = record(manifest.acquisition)
  return cleanAttribution({
    ...acquisitionAttribution,
    source: acquisition.source,
    channel: acquisition.channel,
  })
}

function extractAttributionFromOutbox(row: PpcOutboxRow): Record<string, unknown> {
  return cleanAttribution({
    ...record(row.attribution),
    ...record(row.payload),
    click_id: row.click_id,
    click_id_type: row.click_id_type,
  })
}

function extractAttributionFromTracking(row: PpcTrackingEventRow): Record<string, unknown> {
  const payload = record(row.payload)
  const payloadAttribution = record(payload.attribution)
  return cleanAttribution({
    ...payloadAttribution,
    traffic_source: row.traffic_source,
    campaign: row.campaign,
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    utm_term: row.utm_term,
    utm_content: row.utm_content,
    keyword: payload.keyword,
    matchtype: payload.matchtype,
    gclid: row.gclid,
    gbraid: row.gbraid,
    wbraid: row.wbraid,
    gad_source: row.gad_source,
    gad_campaignid: row.gad_campaignid,
    gad_adgroupid: row.gad_adgroupid,
    oppref: payload.oppref ?? payloadAttribution.oppref,
    skc_openai_click_id: payload.skc_openai_click_id ?? payloadAttribution.skc_openai_click_id,
    landingUrl: row.page_location,
    referrer: row.page_referrer,
  })
}

function cleanAttribution(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const clean = typeof value === 'string' ? value.trim() : value
    if (clean !== undefined && clean !== null && clean !== '') output[key] = clean
  }
  return output
}

function mergeAttribution(current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  return cleanAttribution({
    ...incoming,
    ...current,
    gclid: current.gclid || incoming.gclid,
    gbraid: current.gbraid || incoming.gbraid,
    wbraid: current.wbraid || incoming.wbraid,
    click_id: current.click_id || incoming.click_id,
    click_id_type: current.click_id_type || incoming.click_id_type,
    skc_openai_click_id: current.skc_openai_click_id || incoming.skc_openai_click_id,
  })
}

function hasClickId(attribution: Record<string, unknown>): boolean {
  return Boolean(paidSourceIdentifier(attribution))
}

function campaignName(attribution: Record<string, unknown>): string {
  return ppcCampaignNameForContext({ attribution })
}

function sourceName(attribution: Record<string, unknown>): string {
  return text(attribution.utm_source) || paidSourceSlug(attribution)
}

function mediumName(attribution: Record<string, unknown>): string {
  return text(attribution.utm_medium) || 'cpc'
}

function keywordName(attribution: Record<string, unknown>): string {
  return text(attribution.utm_term) ||
    text(attribution.keyword) ||
    queryParamFromAttribution(attribution, 'utm_term') ||
    queryParamFromAttribution(attribution, 'keyword') ||
    'Keyword not passed'
}

function contentName(attribution: Record<string, unknown>): string {
  return text(attribution.utm_content) || 'Unmapped ad'
}

function campaignId(attribution: Record<string, unknown>): string {
  return text(attribution.gad_campaignid) ||
    text(attribution.campaign_id) ||
    text(attribution.campaignid) ||
    queryParamFromAttribution(attribution, 'gad_campaignid') ||
    queryParamFromAttribution(attribution, 'campaignid') ||
    'unmapped'
}

function adGroupId(attribution: Record<string, unknown>): string {
  return text(attribution.gad_adgroupid) ||
    text(attribution.adgroup_id) ||
    text(attribution.adgroupid) ||
    queryParamFromAttribution(attribution, 'gad_adgroupid') ||
    queryParamFromAttribution(attribution, 'adgroupid') ||
    'unmapped'
}

function displayPhone(phone: string | null): string {
  const phoneDigits = digits(phone)
  const ten = phoneDigits.length === 11 && phoneDigits.startsWith('1') ? phoneDigits.slice(1) : phoneDigits
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return phone || '--'
}

function displayName(lead: PpcLeadRow): string {
  const name = text(lead.full_name)
  if (name && !/^(unknown|caller|new call)/i.test(name)) return name
  return displayPhone(lead.phone)
}

function hasTestMarker(...values: Array<unknown>): boolean {
  return values.some((value) => typeof value === 'string' && /(^|[^a-z0-9])(codex|test|dummy|probe|smoke)([^a-z0-9]|$)/i.test(value))
}

function isTestAttribution(attribution: Record<string, unknown>): boolean {
  return hasTestMarker(attribution.gclid, attribution.gbraid, attribution.wbraid, attribution.click_id, attribution.skc_openai_click_id, attribution.utm_term, attribution.utm_content)
}

function isTestState(state: LeadState): boolean {
  return hasTestMarker(state.lead.full_name, state.lead.email, state.lead.property_address, state.lead.phone) || isTestAttribution(state.attribution)
}

function isTestTrackingEvent(row: PpcTrackingEventRow): boolean {
  const attribution = extractAttributionFromTracking(row)
  return Boolean(row.is_test) || hasTestMarker(
    row.event_id,
    row.session_id,
    row.visitor_id,
    row.gclid,
    row.gbraid,
    row.wbraid,
    attribution.gclid,
    attribution.gbraid,
    attribution.wbraid,
    attribution.skc_openai_click_id,
    row.payload?.gclid,
    row.payload?.gbraid,
    row.payload?.wbraid,
    row.payload?.skc_openai_click_id,
  )
}

function eventName(row: PpcTrackingEventRow): string {
  return text(row.event_name)
}

function eventKey(row: PpcTrackingEventRow): string {
  return text(row.session_id) || text(row.visitor_id) || text(row.event_id) || row.id
}

function clickIdFromTracking(row: PpcTrackingEventRow): string {
  const attribution = extractAttributionFromTracking(row)
  return paidSourceIdentifier(attribution)
}

function sessionKey(row: PpcTrackingEventRow): string {
  return clickIdFromTracking(row) || eventKey(row)
}

function payloadText(row: PpcTrackingEventRow, key: string): string {
  return text(record(row.payload)[key])
}

function payloadRecord(row: PpcTrackingEventRow, key: string): Record<string, unknown> {
  return record(record(row.payload)[key])
}

function sessionDevice(rows: PpcTrackingEventRow[]): string {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!row) continue
    const device = payloadRecord(row, 'device')
    const browser = payloadRecord(row, 'browser')
    const platform = text(device.device_platform) || text(browser.platform)
    const type = text(device.device_type)
    const mobile = device.device_mobile
    const fallbackType = mobile === true
      ? 'mobile'
      : mobile === false
        ? 'desktop'
        : Number(browser.touch_points) > 0
          ? 'touch'
          : ''
    const label = [platform, type || fallbackType].filter(Boolean).join(' / ')
    if (label) return label
  }
  return '--'
}

function latestRowText(rows: PpcTrackingEventRow[], key: keyof PpcTrackingEventRow): string {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = text(rows[index]?.[key])
    if (value) return value
  }
  return '--'
}

function queryParamFromAttribution(attribution: Record<string, unknown>, key: string): string {
  const landingUrl = text(attribution.landingUrl)
  if (!landingUrl) return ''
  try {
    return text(new URL(landingUrl).searchParams.get(key))
  } catch {
    return ''
  }
}

function compactClickId(value: string): string {
  if (!value) return '--'
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value
}

function sessionStatus(rows: PpcTrackingEventRow[]): PpcReport['recentSessions'][number]['status'] {
  const names = new Set(rows.map(eventName))
  const statuses = new Set(rows.map((row) => text(row.form_status)))
  if (names.has('lead_submitted') || statuses.has('submitted')) return 'submitted'
  if (names.has('lead_stage3_completed') || names.has('step_3_field_completed') || statuses.has('stage_3_complete_no_submit')) return 'step_3_no_submit'
  if (names.has('ppc_potential_lead_created') || statuses.has('potential_no_submit')) return 'potential'
  if (names.has('address_typed')) return 'address_only'
  if (rows.some((row) => (row.form_step ?? 0) >= 3) || names.has('lead_quiz_qualified')) return 'reached_step_3'
  if (names.has('cta_click') || names.has('nav_click') || names.has('faq_opened') || names.has('scroll_depth_reached')) return 'engaged'
  if (names.has('situation_selected') || names.has('timeline_selected') || names.has('condition_selected') || names.has('form_step_completed')) return 'engaged'
  if (rows.some((row) => isPhoneSignal(row))) return 'phone_click'
  return 'visit_only'
}

function sessionLabel(status: PpcReport['recentSessions'][number]['status']): string {
  if (status === 'visit_only') return 'Visit only'
  if (status === 'phone_click') return 'Phone click'
  if (status === 'engaged') return 'Engaged'
  if (status === 'reached_step_3') return 'Reached Step 3'
  if (status === 'address_only') return 'Address typed'
  if (status === 'potential') return 'Potential'
  if (status === 'step_3_no_submit') return 'Step 3 only'
  return 'Submitted'
}

function makeLeadState(lead: PpcLeadRow): LeadState {
  return {
    lead,
    attribution: {},
    formSubmitted: false,
    stage3Complete: false,
    potentialNoSubmit: false,
    hasPpcCall: false,
    connectedCallIds: new Set(),
    milestone60s: new Set(),
    milestone2m: new Set(),
    milestone5m: new Set(),
    appointmentIds: new Set(),
    revenue: 0,
    latestSignalAt: lead.updated_at || lead.created_at,
    latestSignal: 'Lead created',
  }
}

function ensureBucket(buckets: Map<string, PpcReport['daily'][number]>, date: string | null) {
  const key = date || new Date().toISOString().slice(0, 10)
  if (!buckets.has(key)) {
    buckets.set(key, { date: key, leads: 0, visits: 0, formSubmits: 0, ppcCalls: 0, phoneClicks: 0, appointments: 0 })
  }
  return buckets.get(key)!
}

function eventAt(row: PpcTrackingEventRow | PpcOutboxRow | null | undefined): string | null {
  if (!row) return null
  return ('event_time' in row ? row.event_time : null) || ('created_at' in row ? row.created_at : null)
}

function firstEventAt(rows: PpcTrackingEventRow[], predicate: (row: PpcTrackingEventRow) => boolean): string | null {
  return eventAt(rows.find(predicate))
}

function hasEvent(rows: PpcTrackingEventRow[], name: string): boolean {
  return rows.some((row) => eventName(row) === name)
}

function isPhoneSignal(row: PpcTrackingEventRow): boolean {
  const name = eventName(row)
  return name === 'phone_click' || name === 'skc_phone_number_selected'
}

function displayChoice(value: string): string {
  if (!value || value === '--') return '--'
  return value.replace(/-/g, ' ')
}

function outboxStatus(row: PpcOutboxRow): string {
  const status = text(row.status).toLowerCase() || 'pending'
  if (row.approved_for_google_ads === false && (status === 'pending' || status === 'processing' || status === 'failed')) {
    return 'Awaiting approval'
  }
  return status.replace(/_/g, ' ')
}

function eventLabel(name: string | null): string {
  const value = text(name)
  if (value === 'lead_submitted') return 'Final Form Submit'
  if (value === 'qualified_lead') return 'Qualified Lead'
  if (value === 'lead_stage3_completed') return 'Step 3 Complete'
  if (value === 'appointment_booked') return 'Appointment Booked'
  if (value === 'call_connected_60s') return 'Call 60+ Seconds'
  if (value === 'call_connected_2m') return 'Call 2+ Minutes'
  if (value === 'call_connected_5m') return 'Call 5+ Minutes'
  return value.replace(/_/g, ' ') || 'Conversion'
}

function isTestOutboxRow(row: PpcOutboxRow): boolean {
  const attribution = record(row.attribution)
  const payload = record(row.payload)
  return hasTestMarker(
    row.id,
    row.dedupe_key,
    row.click_id,
    attribution.gclid,
    attribution.gbraid,
    attribution.wbraid,
    attribution.skc_openai_click_id,
    attribution.utm_term,
    attribution.utm_content,
    payload.gclid,
    payload.gbraid,
    payload.wbraid,
    payload.skc_openai_click_id,
    payload.email,
    payload.phone,
    payload.name,
  )
}

function clickIdType(row: PpcOutboxRow, attribution: Record<string, unknown>): string {
  return text(row.click_id_type) || paidSourceIdentifierType(attribution)
}

function clickIdForOutbox(row: PpcOutboxRow, attribution: Record<string, unknown>): string {
  return compactClickId(text(row.click_id) || paidSourceIdentifier(attribution))
}

function buildConversionApprovalRow(
  row: PpcOutboxRow,
  statesByLeadId: Map<string, LeadState>,
  now: Date,
): PpcReport['conversionApprovalQueue'][number] {
  const state = row.lead_id ? statesByLeadId.get(row.lead_id) ?? null : null
  const attribution = state
    ? mergeAttribution(state.attribution, extractAttributionFromOutbox(row))
    : extractAttributionFromOutbox(row)
  const deadline = conversionDeadline(row.event_time || row.created_at, now)
  const qualityScore = resolveGoogleAdsQualityScore(row.conversion_value, row.payload)
  const suggestedQualityScore = qualityScore ?? defaultGoogleAdsQualityScore(text(row.event_name))

  return {
    id: row.id,
    eventName: text(row.event_name) || 'conversion',
    eventLabel: eventLabel(row.event_name),
    category: text(row.event_category) || 'conversion',
    role: text(row.optimization_role) || 'secondary',
    status: outboxStatus(row),
    leadId: row.lead_id,
    leadName: state ? displayName(state.lead) : 'Unlinked conversion',
    leadPhone: state ? displayPhone(state.lead.phone) : '--',
    leadAddress: state ? text(state.lead.property_address) || text(state.lead.city) || '--' : '--',
    campaign: campaignName(attribution),
    clickId: clickIdForOutbox(row, attribution),
    clickIdType: clickIdType(row, attribution),
    eventTime: row.event_time || row.created_at,
    expiresAt: deadline.expiresAt,
    ageDays: deadline.ageDays,
    daysLeft: deadline.daysLeft,
    deadlineStatus: deadline.status,
    qualityScore,
    suggestedQualityScore,
    attempts: Number(row.attempts ?? 0),
    lastError: text(row.last_error),
    approvedAt: row.approved_at ?? null,
    approvedBy: text(row.approved_by) || '--',
    approvalNote: text(row.approval_note),
  }
}

function buildJourneySteps({
  ordered,
  attribution,
  leadState,
  outboxRows,
}: {
  ordered: PpcTrackingEventRow[]
  attribution: Record<string, unknown>
  leadState: LeadState | null
  outboxRows: PpcOutboxRow[]
}): PpcReport['journeySessions'][number]['steps'] {
  const clickId = clickIdFromTracking(ordered[0]) || text(attribution.click_id)
  const visitAt = firstEventAt(ordered, (row) => {
    const name = eventName(row)
    return name === 'ppc_landing_request' || name === 'ppc_visit_started' || name === 'page_view'
  })
  const phoneAt = firstEventAt(ordered, isPhoneSignal)
  const phoneLabel = ordered
    .map((row) => payloadText(row, 'ppc_phone_display') || payloadText(row, 'phone_display') || text(row.phone_number))
    .find(Boolean)
  const situation = latestRowText(ordered, 'situation_raw')
  const timeline = latestRowText(ordered, 'timeline_raw')
  const condition = latestRowText(ordered, 'condition_raw')
  const step2At = firstEventAt(ordered, (row) => eventName(row) === 'form_step_completed' && (row.form_step ?? 0) >= 2)
  const step3At = firstEventAt(ordered, (row) => (
    (row.form_step ?? 0) >= 3 ||
    eventName(row) === 'lead_quiz_qualified' ||
    eventName(row) === 'lead_stage3_completed' ||
    eventName(row) === 'step_3_field_completed'
  ))
  const addressAt = firstEventAt(ordered, (row) => eventName(row) === 'address_typed' || Boolean(payloadText(row, 'address')))
  const addressSource = Array.from(new Set(ordered.map((row) => payloadText(row, 'address_source')).filter(Boolean)))[0] || ''
  const submittedAt = firstEventAt(ordered, (row) => eventName(row) === 'lead_submitted' || text(row.form_status) === 'submitted')
  const exportOutbox = outboxRows.find((row) => outboxStatus(row) === 'sent') ?? outboxRows[0] ?? null
  const leadAt = leadState?.lead.created_at ?? null

  return [
    {
      key: 'ad_click',
      label: 'Ad Click',
      status: clickId ? 'complete' : 'active',
      detail: clickId ? compactClickId(clickId) : 'No click ID',
      at: ordered[0]?.event_time || ordered[0]?.created_at || null,
    },
    {
      key: 'page_visit',
      label: 'Page Visit',
      status: visitAt ? 'complete' : 'missing',
      detail: visitAt ? 'Visit logged' : 'No visit event',
      at: visitAt,
    },
    {
      key: 'phone_signal',
      label: 'PPC Phone',
      status: phoneAt ? 'complete' : 'missing',
      detail: phoneAt ? `${phoneLabel || 'PPC phone'} shown` : 'No phone signal',
      at: phoneAt,
    },
    {
      key: 'situation',
      label: 'Situation',
      status: situation !== '--' || hasEvent(ordered, 'situation_selected') ? 'complete' : 'missing',
      detail: displayChoice(situation),
      at: firstEventAt(ordered, (row) => eventName(row) === 'situation_selected' || Boolean(row.situation_raw)),
    },
    {
      key: 'step_2',
      label: 'Step 2 Done',
      status: step2At ? 'complete' : 'missing',
      detail: [displayChoice(timeline), displayChoice(condition)].filter((value) => value !== '--').join(' / ') || 'Not reached',
      at: step2At,
    },
    {
      key: 'step_3',
      label: 'Step 3 Ready',
      status: step3At ? 'complete' : 'missing',
      detail: step3At ? 'Qualified/contact step' : 'Not reached',
      at: step3At,
    },
    {
      key: 'address',
      label: 'Address',
      status: addressAt ? 'complete' : 'missing',
      detail: addressSource === 'google_places' ? 'Google Places' : addressSource === 'typed' ? 'Typed' : 'No address',
      at: addressAt,
    },
    {
      key: 'crm_lead',
      label: 'CRM Lead',
      status: leadState ? 'complete' : 'missing',
      detail: leadState ? displayName(leadState.lead) : 'No CRM lead',
      at: leadAt,
    },
    {
      key: 'final_submit',
      label: 'Final Submit',
      status: submittedAt || leadState?.formSubmitted ? 'complete' : leadState ? 'active' : 'missing',
      detail: submittedAt || leadState?.formSubmitted ? 'Submitted' : leadState ? 'Lead saved, no submit' : 'Not submitted',
      at: submittedAt,
    },
    {
      key: 'ads_outbox',
      label: 'Conversion Signal',
      status: exportOutbox ? (outboxStatus(exportOutbox) === 'sent' ? 'complete' : 'active') : submittedAt ? 'complete' : 'missing',
      detail: exportOutbox ? `${eventLabel(exportOutbox.event_name)}: ${outboxStatus(exportOutbox)}` : submittedAt ? 'Primary conversion tracked by GTM' : 'Not queued',
      at: eventAt(exportOutbox) ?? submittedAt,
    },
  ]
}

function fallbackExportConfig(): PpcConversionExportConfigHealth {
  return {
    configured: false,
    mode: 'not_configured',
    enabledDestinations: [],
    googleAds: {
      enabled: false,
      ready: false,
      customerId: null,
      apiVersion: null,
      missingConfig: [],
      configuredActionMappings: [],
      missingActionMappings: [],
    },
    stape: {
      enabled: false,
      ready: false,
      endpointHost: null,
      previewHeaderConfigured: false,
      missingConfig: [],
    },
    openaiAds: {
      enabled: false,
      ready: false,
      pixelIdConfigured: false,
      apiKeyConfigured: false,
      missingConfig: [],
    },
    ga4: {
      enabled: false,
      ready: false,
      measurementIdConfigured: false,
      apiSecretConfigured: false,
      missingConfig: [],
    },
    warnings: ['Export worker configuration was not included in this report response.'],
  }
}

export function buildPpcReport(input: PpcReportInput): PpcReport {
  const reportNow = input.now instanceof Date
    ? input.now
    : typeof input.now === 'string'
      ? new Date(input.now)
      : new Date()
  const leadStates = new Map<string, LeadState>()
  const buckets = new Map<string, PpcReport['daily'][number]>()

  for (const lead of input.leads) {
    leadStates.set(lead.id, makeLeadState(lead))
    ensureBucket(buckets, compactDate(lead.created_at)).leads += 1
  }

  for (const row of input.manifests) {
    if (!row.lead_id || !row.manifest) continue
    const state = leadStates.get(row.lead_id)
    if (!state) continue
    state.attribution = mergeAttribution(state.attribution, extractAttributionFromManifest(row.manifest))
  }

  const exportableOutbox = input.outbox.filter((row) => isGoogleAdsExportablePpcEvent(text(row.event_name)))

  const exportHealth = {
    total: exportableOutbox.length,
    primary: 0,
    secondary: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    deadLetter: 0,
    skipped: 0,
    awaitingApproval: 0,
    approvedPending: 0,
  }

  for (const row of exportableOutbox) {
    const role = text(row.optimization_role).toLowerCase()
    if (role === 'primary') exportHealth.primary += 1
    if (role === 'secondary') exportHealth.secondary += 1

    const status = text(row.status).toLowerCase()
    const needsApproval = isGoogleAdsApprovalRequiredPpcEvent(text(row.event_name), row.payload)
    if (needsApproval && row.approved_for_google_ads === false && (status === 'pending' || status === 'processing' || status === 'failed')) {
      exportHealth.awaitingApproval += 1
    }
    if (row.approved_for_google_ads === true && (status === 'pending' || status === 'processing' || status === 'failed')) {
      exportHealth.approvedPending += 1
    }
    if (status === 'pending' || status === 'processing') exportHealth.pending += 1
    if (status === 'sent') exportHealth.sent += 1
    if (status === 'failed') exportHealth.failed += 1
    if (status === 'dead_letter') exportHealth.deadLetter += 1
    if (status === 'skipped') exportHealth.skipped += 1

    if (!row.lead_id) continue
    const state = leadStates.get(row.lead_id)
    if (!state) continue

    state.attribution = mergeAttribution(state.attribution, extractAttributionFromOutbox(row))
    const event = text(row.event_name)
    if (event === 'lead_submitted') {
      state.formSubmitted = true
      ensureBucket(buckets, compactDate(row.event_time || row.created_at)).formSubmits += 1
    }
    if (event === 'lead_stage3_completed') state.stage3Complete = true
    if (event === 'call_connected_60s') state.milestone60s.add(milestoneKey(event, outboxId(row)))
    if (event === 'call_connected_2m') state.milestone2m.add(milestoneKey(event, outboxId(row)))
    if (event === 'call_connected_5m') state.milestone5m.add(milestoneKey(event, outboxId(row)))
    if (event.startsWith('call_connected_')) state.hasPpcCall = true
  }

  for (const activity of input.activities) {
    if (!activity.lead_id) continue
    const state = leadStates.get(activity.lead_id)
    if (!state) continue

    if (isFormSubmit(activity)) {
      state.formSubmitted = true
      ensureBucket(buckets, compactDate(activity.created_at)).formSubmits += 1
    }
    if (isStage3Complete(activity)) state.stage3Complete = true
    if (isPotentialNoSubmit(activity)) state.potentialNoSubmit = true

    const event = activityEvent(activity)
    const id = activityId(activity)
    if (event === 'call_connected_60s') state.milestone60s.add(milestoneKey(event, id))
    if (event === 'call_connected_2m') state.milestone2m.add(milestoneKey(event, id))
    if (event === 'call_connected_5m') state.milestone5m.add(milestoneKey(event, id))

    if (isPpcActivity(activity)) {
      if (isConnectedCall(activity)) {
        state.connectedCallIds.add(id)
        ensureBucket(buckets, compactDate(activity.created_at)).ppcCalls += 1
      }
      if (isConnectedCall(activity) || event.startsWith('call_connected_')) {
        state.hasPpcCall = true
      }
    }

    const createdAt = activity.created_at
    if (createdAt && latestAt(createdAt, state.latestSignalAt) === createdAt) {
      state.latestSignalAt = createdAt
      state.latestSignal = text(activity.description) || text(activity.activity_type) || 'Activity'
    }
  }

  for (const appointment of input.appointments) {
    if (!appointment.lead_id) continue
    const state = leadStates.get(appointment.lead_id)
    if (!state) continue
    const status = text(appointment.status).toLowerCase()
    if (status !== 'cancelled' && status !== 'no_show') {
      state.appointmentIds.add(appointment.id)
      ensureBucket(buckets, compactDate(appointment.created_at || appointment.scheduled_at)).appointments += 1
    }
  }

  for (const row of input.revenue) {
    if (!row.deal_id) continue
    const state = leadStates.get(row.deal_id)
    if (!state) continue
    state.revenue += money(row.amount)
  }

  const allStates = Array.from(leadStates.values())
  const testLeadCount = allStates.filter(isTestState).length
  const states = allStates.filter((state) => !isTestState(state))
  const trackingEvents = input.trackingEvents.filter((row) => !isTestTrackingEvent(row))
  const testEventCount = input.trackingEvents.length - trackingEvents.length
  const visitKeys = new Set(
    trackingEvents
      .filter((row) => {
        const name = eventName(row)
        return name === 'ppc_landing_request' || name === 'ppc_visit_started' || name === 'page_view'
      })
      .map(eventKey),
  )
  const paidVisits = visitKeys.size
  const phoneClicks = trackingEvents.filter(isPhoneSignal).length
  const optionSelections = trackingEvents.filter((row) => ['situation_selected', 'timeline_selected', 'condition_selected'].includes(eventName(row))).length
  const step1Completions = trackingEvents.filter((row) => eventName(row) === 'form_step_completed' && row.form_step === 1).length
  const step2Completions = trackingEvents.filter((row) => eventName(row) === 'form_step_completed' && row.form_step === 2).length
  const consentedSubmits = trackingEvents.filter((row) => eventName(row) === 'lead_submitted' && row.sms_consent === true).length
  const totalLeads = states.length
  const formSubmits = states.filter((state) => state.formSubmitted).length
  const stage3NoSubmit = states.filter((state) => state.stage3Complete && !state.formSubmitted).length
  const callLeads = states.filter((state) => state.hasPpcCall).length
  const connectedCalls = states.reduce((sum, state) => sum + state.connectedCallIds.size, 0)
  const call60s = states.reduce((sum, state) => sum + state.milestone60s.size, 0)
  const call2m = states.reduce((sum, state) => sum + state.milestone2m.size, 0)
  const call5m = states.reduce((sum, state) => sum + state.milestone5m.size, 0)
  const qualified = states.filter((state) => QUALIFIED_STAGES.has(normalizeStage(state.lead.station))).length
  const appointments = states.filter((state) => state.appointmentIds.size > 0 || APPOINTMENT_STAGES.has(normalizeStage(state.lead.station))).length
  const contracts = states.filter((state) => CONTRACT_STAGES.has(normalizeStage(state.lead.station))).length
  const revenue = states.reduce((sum, state) => sum + state.revenue, 0)
  const clickIds = states.filter((state) => hasClickId(state.attribution)).length
  const attributionCoverage = states.filter((state) => campaignName(state.attribution) !== 'Search 2026' || hasClickId(state.attribution)).length
  const sourceMediumCoverage = states.filter((state) => sourceName(state.attribution) && mediumName(state.attribution)).length
  const gclidRows = states.filter((state) => text(state.attribution.gclid) || text(state.attribution.click_id_type) === 'gclid').length
  const gbraidRows = states.filter((state) => text(state.attribution.gbraid) || text(state.attribution.click_id_type) === 'gbraid').length
  const wbraidRows = states.filter((state) => text(state.attribution.wbraid) || text(state.attribution.click_id_type) === 'wbraid').length
  const missingClickIdRows = Math.max(0, totalLeads - clickIds)

  const funnelCounts = [
    { key: 'leads', label: 'PPC CRM Leads', count: totalLeads },
    { key: 'stage3', label: 'Stage 3 Ready', count: states.filter((state) => state.stage3Complete).length },
    { key: 'submits', label: 'Final Form Submit', count: formSubmits },
    { key: 'qualified', label: 'Qualified', count: qualified },
    { key: 'appointments', label: 'Appointment Set', count: appointments },
    { key: 'contracts', label: 'Contract / Closing', count: contracts },
  ]

  const funnel = funnelCounts.map((step, index) => ({
    ...step,
    rateFromPrevious: index === 0 ? null : pct(step.count, funnelCounts[index - 1]?.count ?? 0),
    rateFromLead: index === 0 ? null : pct(step.count, totalLeads),
  }))

  const callQuality = [
    { key: 'connected', label: 'Connected PPC Calls', count: connectedCalls, shareOfConnected: null },
    { key: '60s', label: '60+ Seconds', count: call60s, shareOfConnected: pct(call60s, connectedCalls) },
    { key: '2m', label: '2+ Minutes', count: call2m, shareOfConnected: pct(call2m, connectedCalls) },
    { key: '5m', label: '5+ Minutes', count: call5m, shareOfConnected: pct(call5m, connectedCalls) },
  ]

  const dailyBuckets = new Map<string, PpcReport['daily'][number]>()
  const activeLeadIds = new Set(states.map((state) => state.lead.id))
  for (const state of states) ensureBucket(dailyBuckets, compactDate(state.lead.created_at)).leads += 1
  for (const row of trackingEvents) {
    const bucket = ensureBucket(dailyBuckets, compactDate(row.event_time || row.created_at))
    const name = eventName(row)
    if (name === 'ppc_landing_request' || name === 'ppc_visit_started' || name === 'page_view') bucket.visits += 1
    if (isPhoneSignal(row)) bucket.phoneClicks += 1
    if (name === 'lead_submitted') bucket.formSubmits += 1
  }
  for (const activity of input.activities) {
    if (!activity.lead_id || !activeLeadIds.has(activity.lead_id)) continue
    if (isPpcActivity(activity) && isConnectedCall(activity)) {
      ensureBucket(dailyBuckets, compactDate(activity.created_at)).ppcCalls += 1
    }
  }
  for (const appointment of input.appointments) {
    if (!appointment.lead_id || !activeLeadIds.has(appointment.lead_id)) continue
    const status = text(appointment.status).toLowerCase()
    if (status !== 'cancelled' && status !== 'no_show') {
      ensureBucket(dailyBuckets, compactDate(appointment.created_at || appointment.scheduled_at)).appointments += 1
    }
  }

  const sessionGroups = new Map<string, PpcTrackingEventRow[]>()
  for (const row of trackingEvents) {
    const key = sessionKey(row)
    sessionGroups.set(key, [...(sessionGroups.get(key) ?? []), row])
  }
  const statesByLeadId = new Map(states.map((state) => [state.lead.id, state]))
  const outboxByLeadId = new Map<string, PpcOutboxRow[]>()
  for (const row of exportableOutbox) {
    if (!row.lead_id) continue
    outboxByLeadId.set(row.lead_id, [...(outboxByLeadId.get(row.lead_id) ?? []), row])
  }

  const allSessionEntries = Array.from(sessionGroups.entries())
  const adClickSessionEntries = allSessionEntries.filter(([, rows]) =>
    rows.some((row) => hasClickId(extractAttributionFromTracking(row)) || Boolean(clickIdFromTracking(row))),
  )
  const hiddenNoClickIdSessionCount = allSessionEntries.length - adClickSessionEntries.length

  const recentSessions = adClickSessionEntries
    .map(([key, rows]) => {
      const ordered = [...rows].sort((a, b) => new Date(a.event_time || a.created_at || 0).getTime() - new Date(b.event_time || b.created_at || 0).getTime())
      const first = ordered[0]
      const last = ordered[ordered.length - 1]
      const attribution = ordered.reduce<Record<string, unknown>>(
        (acc, row) => mergeAttribution(acc, extractAttributionFromTracking(row)),
        {},
      )
      const leadIds = Array.from(new Set(ordered.map((row) => row.lead_id).filter((id): id is string => Boolean(id))))
      const addressSources = Array.from(new Set(ordered.map((row) => payloadText(row, 'address_source')).filter(Boolean)))
      const addressSignal = addressSources.includes('google_places')
        ? 'Google Places'
        : addressSources.includes('typed')
          ? 'Typed'
          : ordered.some((row) => eventName(row) === 'address_typed')
            ? 'Typed'
            : '--'
      const status = sessionStatus(ordered)
      return {
        key,
        firstEventAt: first?.event_time || first?.created_at || null,
        lastEventAt: last?.event_time || last?.created_at || null,
        eventCount: ordered.length,
        status,
        maxStep: Math.max(0, ...ordered.map((row) => row.form_step ?? 0)),
        lastEvent: sessionLabel(status),
        campaign: campaignName(attribution),
        source: sourceName(attribution),
        medium: mediumName(attribution),
        clickId: compactClickId(clickIdFromTracking(first) || text(attribution.click_id)),
        device: sessionDevice(ordered),
        situation: latestRowText(ordered, 'situation_raw'),
        timeline: latestRowText(ordered, 'timeline_raw'),
        condition: latestRowText(ordered, 'condition_raw'),
        addressSignal,
        leadId: leadIds[0] ?? null,
      } satisfies PpcReport['recentSessions'][number]
    })
    .sort((a, b) => new Date(b.lastEventAt || b.firstEventAt || 0).getTime() - new Date(a.lastEventAt || a.firstEventAt || 0).getTime())
    .slice(0, RECENT_SESSION_LIMIT)

  const journeySessions = adClickSessionEntries
    .map(([key, rows]) => {
      const ordered = [...rows].sort((a, b) => new Date(a.event_time || a.created_at || 0).getTime() - new Date(b.event_time || b.created_at || 0).getTime())
      const first = ordered[0]
      const last = ordered[ordered.length - 1]
      const attribution = ordered.reduce<Record<string, unknown>>(
        (acc, row) => mergeAttribution(acc, extractAttributionFromTracking(row)),
        {},
      )
      const leadIds = Array.from(new Set(ordered.map((row) => row.lead_id).filter((id): id is string => Boolean(id))))
      const leadState = leadIds.map((id) => statesByLeadId.get(id)).find((state): state is LeadState => Boolean(state)) ?? null
      const linkedOutbox = leadIds.flatMap((id) => outboxByLeadId.get(id) ?? [])
      const address = [...ordered]
        .reverse()
        .map((row) => payloadText(row, 'address'))
        .find(Boolean) || '--'

      return {
        key,
        firstEventAt: first?.event_time || first?.created_at || null,
        lastEventAt: last?.event_time || last?.created_at || null,
        eventCount: ordered.length,
        campaign: campaignName(attribution),
        source: sourceName(attribution),
        medium: mediumName(attribution),
        clickId: compactClickId(clickIdFromTracking(first) || text(attribution.click_id)),
        device: sessionDevice(ordered),
        leadId: leadState?.lead.id ?? leadIds[0] ?? null,
        leadName: leadState ? displayName(leadState.lead) : 'No CRM lead',
        choices: {
          situation: displayChoice(latestRowText(ordered, 'situation_raw')),
          timeline: displayChoice(latestRowText(ordered, 'timeline_raw')),
          condition: displayChoice(latestRowText(ordered, 'condition_raw')),
          address,
        },
        steps: buildJourneySteps({ ordered, attribution, leadState, outboxRows: linkedOutbox }),
      } satisfies PpcReport['journeySessions'][number]
    })
    .sort((a, b) => new Date(b.lastEventAt || b.firstEventAt || 0).getTime() - new Date(a.lastEventAt || a.firstEventAt || 0).getTime())
    .slice(0, JOURNEY_SESSION_LIMIT)

  const attributionMap = new Map<string, PpcReport['attributionRows'][number]>()
  for (const state of states) {
    const attribution = state.attribution
    const row = {
      source: sourceName(attribution),
      medium: mediumName(attribution),
      campaign: campaignName(attribution),
      campaignId: campaignId(attribution),
      adGroupId: adGroupId(attribution),
      keyword: keywordName(attribution),
      content: contentName(attribution),
    }
    const key = [
      row.source,
      row.medium,
      row.campaign,
      row.campaignId,
      row.adGroupId,
      row.keyword,
      row.content,
    ].join('|')
    if (!attributionMap.has(key)) {
      attributionMap.set(key, {
        key,
        ...row,
        leads: 0,
        formSubmits: 0,
        stage3NoSubmit: 0,
        callLeads: 0,
        appointments: 0,
        contracts: 0,
        revenue: 0,
        clickIds: 0,
      })
    }
    const group = attributionMap.get(key)!
    group.leads += 1
    if (state.formSubmitted) group.formSubmits += 1
    if (state.stage3Complete && !state.formSubmitted) group.stage3NoSubmit += 1
    if (state.hasPpcCall) group.callLeads += 1
    if (state.appointmentIds.size > 0 || APPOINTMENT_STAGES.has(normalizeStage(state.lead.station))) group.appointments += 1
    if (CONTRACT_STAGES.has(normalizeStage(state.lead.station))) group.contracts += 1
    if (hasClickId(attribution)) group.clickIds += 1
    group.revenue += state.revenue
  }

  const allRecentLeads = states
    .map((state) => {
      const attribution = state.attribution
      const highestCallQuality = state.milestone5m.size > 0
        ? '5m+'
        : state.milestone2m.size > 0
          ? '2m+'
          : state.milestone60s.size > 0
            ? '60s+'
            : state.connectedCallIds.size > 0
              ? 'Connected'
              : '--'
      const formStatus = state.formSubmitted
        ? 'submitted'
        : state.stage3Complete
          ? 'stage_3_no_submit'
          : state.potentialNoSubmit
            ? 'potential_no_submit'
            : state.hasPpcCall
              ? 'call_only'
              : 'lead_only'
      const clickId = paidSourceIdentifier(attribution) || '--'
      return {
        id: state.lead.id,
        name: displayName(state.lead),
        phone: displayPhone(state.lead.phone),
        address: text(state.lead.property_address) || text(state.lead.city) || '--',
        stage: normalizeStage(state.lead.station).replace(/_/g, ' '),
        createdAt: state.lead.created_at,
        lastSignalAt: state.latestSignalAt,
        lastSignal: state.latestSignal,
        formStatus,
        campaign: campaignName(attribution),
        keyword: keywordName(attribution),
        clickId,
        callQuality: highestCallQuality,
        revenue: state.revenue,
      } satisfies PpcReport['recentLeads'][number]
    })
    .sort((a, b) => new Date(b.lastSignalAt || b.createdAt || 0).getTime() - new Date(a.lastSignalAt || a.createdAt || 0).getTime())
  const recentLeads = allRecentLeads.slice(0, RECENT_LEAD_LIMIT)

  const conversionApprovalQueue = exportableOutbox
    .filter((row) => text(row.status).toLowerCase() !== 'sent')
    .filter((row) => isGoogleAdsApprovalRequiredPpcEvent(text(row.event_name), row.payload))
    .filter((row) => !isTestOutboxRow(row))
    .filter((row) => {
      if (!row.lead_id) return true
      return statesByLeadId.has(row.lead_id)
    })
    .map((row) => buildConversionApprovalRow(row, statesByLeadId, reportNow))
    .sort((a, b) => {
      const severity = { expired: 0, critical: 1, urgent: 2, review: 3, normal: 4 } satisfies Record<ConversionDeadlineStatus, number>
      return severity[a.deadlineStatus] - severity[b.deadlineStatus] ||
        new Date(a.eventTime || 0).getTime() - new Date(b.eventTime || 0).getTime()
    })
    .slice(0, 50)

  const conversionApproval = {
    awaitingApproval: conversionApprovalQueue.filter((row) => row.qualityScore == null).length,
    approvedPending: conversionApprovalQueue.filter((row) => row.qualityScore != null && row.status !== 'sent').length,
    review: conversionApprovalQueue.filter((row) => row.deadlineStatus === 'review').length,
    urgent: conversionApprovalQueue.filter((row) => row.deadlineStatus === 'urgent').length,
    critical: conversionApprovalQueue.filter((row) => row.deadlineStatus === 'critical').length,
    expired: conversionApprovalQueue.filter((row) => row.deadlineStatus === 'expired').length,
    score1: conversionApprovalQueue.filter((row) => row.qualityScore === 1).length,
    score2: conversionApprovalQueue.filter((row) => row.qualityScore === 2).length,
    score3: conversionApprovalQueue.filter((row) => row.qualityScore === 3).length,
  }

  const readyExportRows = exportableOutbox.filter((row) => {
    const status = text(row.status).toLowerCase()
    if (!['pending', 'processing', 'failed'].includes(status)) return false
    return row.approved_for_google_ads || !isGoogleAdsApprovalRequiredPpcEvent(text(row.event_name), row.payload)
  })
  const oldestReadyAt = readyExportRows.reduce<string | null>(
    (oldest, row) => olderIso(oldest, row.event_time || row.created_at),
    null,
  )
  const lastSentAt = exportableOutbox.reduce<string | null>(
    (newest, row) => newerIso(newest, row.sent_at),
    null,
  )
  const oldestReadyAgeHours = ageHours(oldestReadyAt, reportNow)
  const exportFailureCount = exportHealth.failed + exportHealth.deadLetter
  const exportStatus = exportFailureCount > 0
    ? 'blocked'
    : readyExportRows.length > 0 && (oldestReadyAgeHours ?? 0) >= 1
      ? 'attention'
      : 'healthy'

  let pendingEscalations = 0
  let overdueEscalations = 0
  let oldestDueAt: string | null = null
  for (const task of input.missedCallTasks ?? []) {
    const metadata = record(task.metadata)
    if (text(metadata.task_type) !== 'google_ads_missed_call_escalation') continue
    if (text(metadata.status).toLowerCase() !== 'pending') continue
    pendingEscalations += 1
    const dueAt = text(metadata.due_date) || task.created_at
    const dueDate = validDate(dueAt)
    if (!dueDate || dueDate.getTime() <= reportNow.getTime()) {
      overdueEscalations += 1
      oldestDueAt = olderIso(oldestDueAt, dueAt)
    }
  }
  const oldestDueAgeMinutes = ageMinutes(oldestDueAt, reportNow)
  const missedCallStatus = overdueEscalations > 0 && (oldestDueAgeMinutes ?? 0) >= 15
    ? 'blocked'
    : overdueEscalations > 0 || pendingEscalations > 0
      ? 'attention'
      : 'healthy'
  const allAttributionRows = Array.from(attributionMap.values())
    .sort((a, b) => b.revenue - a.revenue || b.formSubmits - a.formSubmits || b.leads - a.leads)
  const attributionRows = allAttributionRows.slice(0, ATTRIBUTION_ROW_LIMIT)

  return {
    generatedAt: Number.isNaN(reportNow.getTime()) ? new Date().toISOString() : reportNow.toISOString(),
    period: {
      days: input.days,
      since: input.since,
      until: input.until,
    },
    summary: {
      paidVisits,
      eventLogTotal: trackingEvents.length,
      optionSelections,
      step1Completions,
      step2Completions,
      phoneClicks,
      consentedSubmits,
      testRecords: testLeadCount + testEventCount,
      totalLeads,
      formSubmits,
      stage3NoSubmit,
      callLeads,
      connectedCalls,
      call60s,
      call2m,
      call5m,
      qualified,
      appointments,
      contracts,
      revenue,
      clickIdCoverageRate: pct(clickIds, totalLeads) ?? 0,
      submitRate: pct(formSubmits, totalLeads) ?? 0,
      appointmentRate: pct(appointments, totalLeads) ?? 0,
      contractRate: pct(contracts, totalLeads) ?? 0,
    },
    funnel,
    callQuality,
    attributionRows,
    exportHealth,
    conversionApproval,
    conversionApprovalQueue,
    dataQuality: {
      clickIdCoverage: pct(clickIds, totalLeads) ?? 0,
      attributionCoverage: totalLeads > 0 ? pct(attributionCoverage, totalLeads) ?? 0 : paidVisits > 0 ? 100 : 0,
      sourceMediumCoverage: pct(sourceMediumCoverage, totalLeads) ?? 0,
      gclidRows,
      gbraidRows,
      wbraidRows,
      missingClickIdRows,
      pendingExports: exportHealth.pending + exportHealth.awaitingApproval,
      failedExports: exportHealth.failed + exportHealth.deadLetter,
    },
    operationsHealth: {
      ppcExportWorker: {
        path: '/api/workers/ppc-conversion-export',
        schedule: 'Every 15 minutes',
        status: exportStatus,
        readyToExport: readyExportRows.length,
        pending: exportHealth.pending,
        awaitingApproval: exportHealth.awaitingApproval,
        failed: exportHealth.failed,
        deadLetter: exportHealth.deadLetter,
        oldestReadyAt,
        oldestReadyAgeHours,
        lastSentAt,
      },
      googleAdsMissedCalls: {
        path: '/api/cron/google-ads-missed-calls',
        schedule: 'Every 5 minutes',
        status: missedCallStatus,
        pendingEscalations,
        overdueEscalations,
        oldestDueAt,
        oldestDueAgeMinutes,
      },
    },
    exportConfig: input.exportConfig ?? fallbackExportConfig(),
    daily: Array.from(dailyBuckets.values()).sort((a, b) => a.date.localeCompare(b.date)),
    recentSessions,
    journeySessions,
    recentLeads,
    resultCounts: {
      journeySessionsShown: journeySessions.length,
      journeySessionsTotal: adClickSessionEntries.length,
      journeySessionsHiddenNoClickId: hiddenNoClickIdSessionCount,
      recentSessionsShown: recentSessions.length,
      recentSessionsTotal: adClickSessionEntries.length,
      recentLeadsShown: recentLeads.length,
      recentLeadsTotal: allRecentLeads.length,
      attributionRowsShown: attributionRows.length,
      attributionRowsTotal: allAttributionRows.length,
    },
  }
}
