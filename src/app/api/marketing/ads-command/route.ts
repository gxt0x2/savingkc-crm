import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import {
  isGoogleAdsApprovalRequiredPpcEvent,
  isGoogleAdsExportablePpcEvent,
  nonExportablePpcEventReason,
} from '@/lib/ppc/exportable-events'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  CAMPAIGNS,
  FUNNEL,
  type CallBreakdownRow,
  type CampaignRow,
  type FunnelBreakdownRow,
  type FunnelRow,
  type KeywordRow,
  type KpiItem,
  type LeadRow,
  type MarketingPeriod,
  type NegativeKeywordRow,
  type OutboxRow,
  type PaidSessionRow,
  type SeriesRow,
} from '@/lib/marketing/ads-command-seed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type GoogleAdsCampaignDailyRow = {
  date: string
  campaign_id: string
  campaign_name: string
  impressions: number | string | null
  clicks: number | string | null
  cost_micros: number | string | null
  conversions: number | string | null
  all_conversions: number | string | null
  imported_at?: string | null
}

type GoogleAdsSearchTermDailyRow = {
  date: string
  campaign_id: string
  campaign_name: string
  ad_group_id: string
  ad_group_name: string
  search_term: string
  keyword_text: string | null
  keyword_match_type: string | null
  impressions: number | string | null
  clicks: number | string | null
  cost_micros: number | string | null
  conversions: number | string | null
  all_conversions: number | string | null
  imported_at?: string | null
}

type PpcTrackingSummaryRow = {
  id: string
  event_id: string | null
  event_name: string | null
  event_category: string | null
  event_time: string | null
  session_id: string | null
  visitor_id: string | null
  lead_id: string | null
  page_path: string | null
  page_location: string | null
  page_referrer: string | null
  traffic_source: string | null
  campaign: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  gad_source: string | null
  gad_campaignid: string | null
  gad_adgroupid: string | null
  form_step: number | null
  form_status: string | null
  situation_raw: string | null
  timeline_raw: string | null
  condition_raw: string | null
  phone_number: string | null
  is_test: boolean | null
  payload: Record<string, unknown> | null
  created_at: string | null
}

type PpcLeadSummaryRow = {
  id: string
  full_name: string | null
  source: string | null
  station: string | null
  priority: string | null
  property_address: string | null
  city: string | null
  county: string | null
  classification: string | null
  opportunity_score: number | null
  created_at: string | null
}

type PpcOutboxSummaryRow = {
  id: string
  event_name: string | null
  event_category: string | null
  dedupe_key: string | null
  status: string | null
  approved_for_google_ads: boolean | null
  optimization_role: string | null
  event_time: string | null
  lead_id: string | null
  conversion_value: number | string | null
  click_id: string | null
  click_id_type: string | null
  attribution: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  attempts: number | string | null
  last_error: string | null
  sent_at: string | null
  created_at: string | null
}

type PpcActivitySummaryRow = {
  lead_id: string | null
  activity_type: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
}

type RevenueSummaryRow = {
  deal_id?: string | null
  amount: number | string | null
}

type GoogleAdsSyncRunRow = {
  status: string | null
  started_at: string | null
  finished_at: string | null
  error: string | null
}

type AdsCommandFreshness = {
  dashboardGeneratedAt: string
  liveTrackingUpdatedAt: string | null
  googleAdsImportedAt: string | null
  googleAdsSyncStatus: string | null
  googleAdsSyncFinishedAt: string | null
}

type AdsCommandResponse = {
  source: 'live'
  generatedAt: string
  syncedLabel: string
  freshness: AdsCommandFreshness
  period: MarketingPeriod
  range: {
    since: string
    until: string
  }
  kpi: KpiItem[]
  series: SeriesRow[]
  campaigns: CampaignRow[]
  keywords: KeywordRow[]
  negatives: NegativeKeywordRow[]
  funnel: FunnelRow[]
  callBreakdown: CallBreakdownRow[]
  leads: LeadRow[]
  outbox: OutboxRow[]
  paidSessions: PaidSessionRow[]
}

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

const CAMPAIGN_COLORS = ['#14b8a6', '#60a5fa', '#22c55e', '#eab308', '#f87171', '#a855f7']
const QUALIFIED_STAGES = new Set(['qualified', 'appointment_set', 'offer_made', 'under_contract', 'closed_won', 'contract_signed', 'closed'])
const PPC_LEAD_SOURCES = ['ppc-landing', 'google_ads', 'google-ads', 'google_ads_phone', 'paid-search']
const TEST_MARKER_RE = /(^|[^a-z0-9])(codex|dummy|probe|smoke|test|internaltesting|internal-testing|internal_filter|internalfilter|filtercheck|hashcheck|finalhash)([^a-z0-9]|$)/i
const CHICAGO_TIME_ZONE = 'America/Chicago'

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function envList(...keys: string[]): string[] {
  return keys
    .flatMap((key) => text(process.env[key]).split(/[\n,]/))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function hasTestMarker(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === 'string' || typeof value === 'number') {
      if (TEST_MARKER_RE.test(String(value))) return true
      continue
    }

    if (value && typeof value === 'object') {
      const entries = Array.isArray(value) ? value : Object.values(value)
      if (hasTestMarker(...entries.slice(0, 80))) return true
    }
  }
  return false
}

function nestedValue(source: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => record(current)[key], source)
}

function hashMatchesConfiguredInternal(hash: unknown): boolean {
  const value = text(hash).toLowerCase()
  if (!value) return false
  return envList('PPC_INTERNAL_IP_HASHES', 'INTERNAL_TRAFFIC_IP_HASHES')
    .some((rule) => rule.length >= 8 && value.startsWith(rule))
}

function isInternalPayload(payload: Record<string, unknown> | null): boolean {
  const body = record(payload)
  if (body.is_internal === true) return true
  if (Array.isArray(body.internal_reasons) && body.internal_reasons.length > 0) return true

  for (const key of ['device', 'request_context', 'context']) {
    const nested = record(body[key])
    if (nested.is_internal === true) return true
    if (Array.isArray(nested.internal_reasons) && nested.internal_reasons.length > 0) return true
    if (hashMatchesConfiguredInternal(nested.ip_hash)) return true
  }

  return hashMatchesConfiguredInternal(body.ip_hash)
    || hashMatchesConfiguredInternal(nestedValue(body, ['devicePayload', 'ip_hash']))
}

function isExternalTrackingRow(row: PpcTrackingSummaryRow): boolean {
  return !row.is_test
    && !isInternalPayload(row.payload)
    && !hasTestMarker(row.event_id, row.session_id, row.visitor_id, row.gclid, row.gbraid, row.wbraid, row.payload)
}

function isExternalOutboxRow(row: PpcOutboxSummaryRow): boolean {
  return !isInternalPayload(row.payload)
    && !hasTestMarker(row.event_name, row.click_id, row.attribution, row.payload)
}

function isExternalLeadRow(row: PpcLeadSummaryRow, activities: PpcActivitySummaryRow[]): boolean {
  const leadActivities = activities.filter((activity) => activity.lead_id === row.id)
  return !hasTestMarker(row.full_name, row.property_address, row.city, row.county)
    && !leadActivities.some((activity) => isInternalPayload(activity.metadata) || hasTestMarker(activity.metadata, activity.description))
}

function readPeriod(value: string | null): MarketingPeriod {
  if (value === 'today' || value === 'yesterday' || value === 'week' || value === 'month' || value === 'qtr' || value === 'ytd') {
    return value
  }
  return 'month'
}

function chicagoDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function periodDays(period: MarketingPeriod, today: string): number {
  if (period === 'today' || period === 'yesterday') return 1
  if (period === 'week') return 7
  if (period === 'qtr') return 90
  if (period === 'ytd') {
    const yearStart = `${today.slice(0, 4)}-01-01`
    return Math.max(1, Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${yearStart}T12:00:00Z`).getTime()) / 86_400_000) + 1)
  }
  return 30
}

function rangeForPeriod(period: MarketingPeriod) {
  const today = chicagoDate()
  if (period === 'today') return { since: today, until: today }
  if (period === 'yesterday') {
    const yesterday = addDays(today, -1)
    return { since: yesterday, until: yesterday }
  }
  if (period === 'month') return { since: addDays(today, -29), until: today }
  if (period === 'ytd') return { since: `${today.slice(0, 4)}-01-01`, until: today }
  const days = periodDays(period, today)
  return { since: addDays(today, -(days - 1)), until: today }
}

function previousRangeForPeriod(period: MarketingPeriod, current: { since: string; until: string }) {
  const days = Math.max(1, Math.round((new Date(`${current.until}T12:00:00Z`).getTime() - new Date(`${current.since}T12:00:00Z`).getTime()) / 86_400_000) + 1)
  const until = addDays(current.since, -1)
  return { since: addDays(until, -(days - 1)), until }
}

function isoStart(date: string): string {
  return `${date}T00:00:00.000Z`
}

function isoAfter(date: string): string {
  return `${addDays(date, 1)}T00:00:00.000Z`
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
  return Math.round(numberValue(value))
}

function spend(row: { cost_micros: number | string | null }): number {
  return numberValue(row.cost_micros) / 1_000_000
}

function pctDelta(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 1000) / 10
}

function safeCost(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) / 100 : 0
}

function normalizeStation(value: string | null | undefined): string {
  const station = (value || '').trim().toLowerCase()
  if (station === 'appt_set' || station === 'appointment') return 'appointment_set'
  if (station === 'contract' || station === 'contract_signed' || station === 'in_closing') return 'under_contract'
  if (station === 'closed') return 'closed_won'
  return station || 'new'
}

function totals(rows: GoogleAdsCampaignDailyRow[]) {
  return rows.reduce((acc, row) => {
    acc.impressions += integer(row.impressions)
    acc.clicks += integer(row.clicks)
    acc.spend += spend(row)
    acc.conversions += numberValue(row.conversions || row.all_conversions)
    return acc
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0 })
}

function colorForCampaign(name: string, index: number): string {
  return CAMPAIGNS.find((campaign) => campaign.name === name)?.color || CAMPAIGN_COLORS[index % CAMPAIGN_COLORS.length]
}

function groupCampaigns(rows: GoogleAdsCampaignDailyRow[], trackingRows: PpcTrackingSummaryRow[], outboxRows: PpcOutboxSummaryRow[], crmLeads: LeadRow[]): CampaignRow[] {
  const byName = new Map<string, CampaignRow>()
  const conversionByCampaign = conversionCountsByCampaign(trackingRows, outboxRows)
  const names = Array.from(new Set([
    ...rows.map((row) => row.campaign_name || 'Unmapped campaign'),
    ...Array.from(conversionByCampaign.keys()),
    ...crmLeads.map((lead) => lead.campaign || 'Search 2026'),
  ])).filter(Boolean).sort()

  names.forEach((name, index) => {
    const campaignRows = rows.filter((row) => row.campaign_name === name)
    const adTotals = totals(campaignRows)
    const conversions = conversionByCampaign.get(name) || { call: 0, form: 0, sms: 0 }
    const crmLeadCount = crmLeads.filter((lead) => lead.campaign === name).length
    byName.set(name, {
      name,
      leads: crmLeadCount,
      spend: Math.round(adTotals.spend),
      call: conversions.call,
      form: crmLeadCount,
      sms: conversions.sms,
      color: colorForCampaign(name, index),
    })
  })

  return Array.from(byName.values()).sort((a, b) => b.spend - a.spend)
}

function conversionCountsByCampaign(trackingRows: PpcTrackingSummaryRow[], outboxRows: PpcOutboxSummaryRow[]) {
  const map = new Map<string, { call: number; form: number; sms: number }>()
  function inc(campaign: string, type: 'call' | 'form' | 'sms') {
    const current = map.get(campaign) || { call: 0, form: 0, sms: 0 }
    current[type] += 1
    map.set(campaign, current)
  }

  for (const row of trackingRows) {
    const campaign = row.campaign || row.utm_campaign || 'Search 2026'
    if (isTrackingCall(row)) inc(campaign, 'call')
    if (row.form_status === 'submitted' || row.event_name === 'lead_submitted') inc(campaign, 'form')
  }

  for (const row of outboxRows) {
    const attribution = row.attribution || {}
    const payload = row.payload || {}
    const campaign = String(attribution.utm_campaign || attribution.campaign || payload.campaign || 'Search 2026')
    const category = String(row.event_category || '').toLowerCase()
    if (category === 'call' || String(row.event_name || '').startsWith('call_')) inc(campaign, 'call')
    else if (category === 'phone') inc(campaign, 'sms')
    else inc(campaign, 'form')
  }

  return map
}

function isTrackingCall(row: PpcTrackingSummaryRow): boolean {
  const eventName = String(row.event_name || '').toLowerCase()
  const category = String(row.event_category || '').toLowerCase()
  return category === 'call' || eventName.startsWith('call_') || eventName.includes('phone_call')
}

function seriesRowForDate(date: string): SeriesRow {
  return {
    date,
    label: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    spend: 0,
    cpl: 0,
    clicks: 0,
    leads: 0,
    qualified: 0,
    conversions: 0,
  }
}

function chicagoDateFromIso(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function livePaidClickIds(rows: PpcTrackingSummaryRow[]): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    const clickId = clickIdFromTracking(row)
    if (clickId) ids.add(clickId)
  }
  return ids
}

function buildSeries(
  rows: GoogleAdsCampaignDailyRow[],
  leadRows: PpcLeadSummaryRow[],
  trackingRows: PpcTrackingSummaryRow[],
  range: { since: string; until: string },
): SeriesRow[] {
  const byDate = new Map<string, SeriesRow>()
  for (let date = range.since; date <= range.until; date = addDays(date, 1)) {
    byDate.set(date, seriesRowForDate(date))
  }

  for (const row of rows) {
    const current = byDate.get(row.date) || seriesRowForDate(row.date)
    current.spend += Math.round(spend(row) * 100) / 100
    current.clicks += integer(row.clicks)
    current.conversions += Math.round(numberValue(row.conversions || row.all_conversions))
    byDate.set(row.date, current)
  }

  for (const lead of leadRows) {
    const date = chicagoDateFromIso(lead.created_at)
    if (!date) continue
    const current = byDate.get(date) || seriesRowForDate(date)
    current.leads += 1
    if (QUALIFIED_STAGES.has(normalizeStation(lead.station))) current.qualified += 1
    byDate.set(date, current)
  }

  const trackedClicksByDate = new Map<string, Set<string>>()
  for (const row of trackingRows) {
    const date = chicagoDateFromIso(row.event_time || row.created_at)
    if (!date) continue
    const key = clickIdFromTracking(row)
    if (!key) continue
    const set = trackedClicksByDate.get(date) ?? new Set<string>()
    set.add(key)
    trackedClicksByDate.set(date, set)
  }

  for (const [date, trackedClicks] of trackedClicksByDate) {
    const current = byDate.get(date) || seriesRowForDate(date)
    current.clicks = Math.max(current.clicks, trackedClicks.size)
    byDate.set(date, current)
  }

  return Array.from(byDate.values())
    .map((row) => ({
      ...row,
      cpl: row.leads > 0 ? Math.round(row.spend / row.leads) : 0,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

function averageCpcByCampaign(rows: GoogleAdsCampaignDailyRow[]): Map<string, number> {
  const totals = new Map<string, { spend: number; clicks: number }>()
  for (const row of rows) {
    const name = row.campaign_name || 'Search 2026'
    const clicks = integer(row.clicks)
    const cost = spend(row)
    const current = totals.get(name) || { spend: 0, clicks: 0 }
    current.spend += cost
    current.clicks += clicks
    totals.set(name, current)

    const all = totals.get('__all') || { spend: 0, clicks: 0 }
    all.spend += cost
    all.clicks += clicks
    totals.set('__all', all)
  }

  return new Map(Array.from(totals.entries()).map(([campaign, total]) => [
    campaign,
    total.clicks > 0 ? total.spend / total.clicks : 0,
  ]))
}

function buildKeywords(rows: GoogleAdsSearchTermDailyRow[], crmLeads: LeadRow[], campaignRows: GoogleAdsCampaignDailyRow[] = []): KeywordRow[] {
  const fallbackCpc = averageCpcByCampaign(campaignRows)
  const byTerm = new Map<string, { row: KeywordRow; spend: number; actualSpend: boolean }>()
  for (const item of rows) {
    const key = item.search_term || item.keyword_text || 'Search term not captured'
    const current = byTerm.get(key) || {
      row: { kw: key, campaign: item.campaign_name || 'Search 2026', clicks: 0, leads: 0, cpl: 0, qual: 0 },
      spend: 0,
      actualSpend: false,
    }
    const rowSpend = spend(item)
    current.row.clicks += integer(item.clicks)
    current.spend += rowSpend
    current.actualSpend = current.actualSpend || rowSpend > 0
    current.row.cpl = current.row.leads > 0 ? Math.round(current.spend / current.row.leads) : 0
    byTerm.set(key, current)
  }

  for (const lead of crmLeads) {
    const key = text(lead.kw) || 'Keyword not captured'
    const current = byTerm.get(key) || {
      row: { kw: key, campaign: lead.campaign || 'Search 2026', clicks: 0, leads: 0, cpl: 0, qual: 0 },
      spend: 0,
      actualSpend: false,
    }
    current.row.campaign = lead.campaign || current.row.campaign
    current.row.clicks = Math.max(current.row.clicks, 1)
    current.row.leads += 1
    if (!current.actualSpend) {
      current.spend += fallbackCpc.get(current.row.campaign) ?? fallbackCpc.get('__all') ?? 0
    }
    current.row.cpl = current.row.leads > 0 ? Math.round(current.spend / current.row.leads) : 0
    current.row.qual = current.row.clicks > 0 ? Math.round((current.row.leads / current.row.clicks) * 100) : 0
    byTerm.set(key, current)
  }

  return Array.from(byTerm.values())
    .map((entry) => entry.row)
    .sort((a, b) => b.leads - a.leads || b.clicks - a.clicks)
    .slice(0, 40)
}

function buildNegatives(rows: GoogleAdsSearchTermDailyRow[]): NegativeKeywordRow[] {
  return buildKeywords(rows, [])
    .filter((row) => row.clicks > 0 && row.leads === 0)
    .slice(0, 20)
    .map((row) => ({ ...row, status: 'suggested' }))
}

function breakdownFromCounts(counts: Map<string, number>, colors = CAMPAIGN_COLORS): FunnelBreakdownRow[] {
  return Array.from(counts.entries())
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], index) => ({ label, value, color: colors[index % colors.length] }))
}

function buildFunnel(
  campaignRows: GoogleAdsCampaignDailyRow[],
  trackingRows: PpcTrackingSummaryRow[],
  leadRows: PpcLeadSummaryRow[],
): FunnelRow[] {
  const adTotals = totals(campaignRows)
  const campaignImpressions = new Map<string, number>()
  const campaignClicks = new Map<string, number>()
  for (const row of campaignRows) {
    campaignImpressions.set(row.campaign_name, (campaignImpressions.get(row.campaign_name) || 0) + integer(row.impressions))
    campaignClicks.set(row.campaign_name, (campaignClicks.get(row.campaign_name) || 0) + integer(row.clicks))
  }

  const situations = new Map<string, number>()
  const conditions = new Map<string, number>()
  const timelines = new Map<string, number>()
  let addressSignals = 0
  const sessions = new Map<string, PpcTrackingSummaryRow[]>()
  for (const row of trackingRows) {
    const key = clickIdFromTracking(row)
    if (!key) continue
    sessions.set(key, [...(sessions.get(key) ?? []), row])
  }
  const trackedCampaignClicks = new Map<string, number>()
  for (const rows of sessions.values()) {
    const attribution = rows.reduce<Record<string, unknown>>(
      (acc, row) => ({ ...acc, ...trackingAttribution(row) }),
      {},
    )
    const campaign = campaignFromAttribution(attribution)
    trackedCampaignClicks.set(campaign, (trackedCampaignClicks.get(campaign) || 0) + 1)

    const situation = latestRowValue(rows, 'situation_raw')
    const condition = latestRowValue(rows, 'condition_raw')
    const timeline = latestRowValue(rows, 'timeline_raw')
    const contactFields = contactFieldsFromEvents(rows)
    const names = new Set(rows.map((row) => text(row.event_name)))
    const maxStep = Math.max(0, ...rows.map((row) => row.form_step ?? 0))
    if (situation) {
      const label = displayText(situation)
      situations.set(label, (situations.get(label) || 0) + 1)
    }
    if (condition) {
      const label = conditionLabel(condition)
      conditions.set(label, (conditions.get(label) || 0) + 1)
    }
    if (timeline) {
      const label = timelineLabel(timeline)
      timelines.set(label, (timelines.get(label) || 0) + 1)
    }
    if (contactFields.includes('address') || maxStep >= 4 || names.has('address_selected') || names.has('address_typed')) addressSignals += 1
  }

  const qualified = leadRows.filter((lead) => QUALIFIED_STAGES.has(normalizeStation(lead.station))).length
  const submittedLeads = leadRows.length
  const clickCount = Math.max(adTotals.clicks, sessions.size)
  const clickBreakdown = campaignClicks.size > 0 ? campaignClicks : trackedCampaignClicks
  const live: FunnelRow[] = [
    {
      ...FUNNEL[0],
      n: adTotals.impressions,
      breakdown: breakdownFromCounts(campaignImpressions),
    },
    {
      ...FUNNEL[1],
      n: clickCount,
      breakdown: breakdownFromCounts(clickBreakdown),
    },
    {
      ...FUNNEL[2],
      n: Array.from(situations.values()).reduce((sum, value) => sum + value, 0),
      breakdown: breakdownFromCounts(situations),
    },
    {
      ...FUNNEL[3],
      n: Array.from(conditions.values()).reduce((sum, value) => sum + value, 0),
      breakdown: breakdownFromCounts(conditions),
    },
    {
      ...FUNNEL[4],
      n: Array.from(timelines.values()).reduce((sum, value) => sum + value, 0),
      breakdown: breakdownFromCounts(timelines),
    },
    {
      ...FUNNEL[5],
      n: addressSignals,
      breakdown: addressSignals > 0 ? [{ label: 'Address signal', value: addressSignals, color: FUNNEL[5].c }] : [],
    },
    {
      ...FUNNEL[6],
      n: submittedLeads,
      breakdown: [
        { label: 'CRM paid leads', value: leadRows.length, color: '#60a5fa' },
      ].filter((row) => row.value > 0),
    },
    {
      ...FUNNEL[7],
      n: qualified,
      breakdown: qualified > 0 ? [{ label: 'Qualified CRM stage', value: qualified, color: FUNNEL[7].c }] : [],
    },
  ]

  return live
}

function buildCallBreakdown(trackingRows: PpcTrackingSummaryRow[], outboxRows: PpcOutboxSummaryRow[]): CallBreakdownRow[] {
  const counts = new Map<string, { value: number; details: Map<string, number> }>()
  function add(label: string, detail: string) {
    const current = counts.get(label) || { value: 0, details: new Map<string, number>() }
    current.value += 1
    current.details.set(detail, (current.details.get(detail) || 0) + 1)
    counts.set(label, current)
  }

  for (const row of trackingRows) {
    if (!isTrackingCall(row)) continue
    add(classifySellerSituation(row.situation_raw || row.campaign || row.utm_campaign), row.situation_raw || row.campaign || 'PPC call')
  }

  for (const row of outboxRows) {
    const event = String(row.event_name || '')
    const category = String(row.event_category || '')
    if (category !== 'call' && !event.startsWith('call_')) continue
    const payload = row.payload || {}
    const attribution = row.attribution || {}
    add(classifySellerSituation(String(payload.situation || attribution.utm_term || attribution.keyword || 'PPC call')), String(attribution.utm_term || attribution.keyword || event || 'PPC call'))
  }

  if (counts.size === 0) return []

  return Array.from(counts.entries()).map(([label, data], index) => ({
    label,
    value: data.value,
    color: CAMPAIGN_COLORS[index % CAMPAIGN_COLORS.length],
    details: Array.from(data.details.entries()).map(([detail, value], detailIndex) => ({
      label: detail,
      value,
      color: CAMPAIGN_COLORS[detailIndex % CAMPAIGN_COLORS.length],
    })),
  }))
}

function classifySellerSituation(value: string | null | undefined): string {
  const text = (value || '').toLowerCase()
  if (/tax|back/.test(text)) return 'Back taxes'
  if (/inherit|probate|estate/.test(text)) return 'Inherited'
  if (/landlord|rental|tenant/.test(text)) return 'Tired landlord'
  if (/vacant|repair|distress/.test(text)) return 'Vacant / repairs'
  return 'Fast cash offer'
}

function buildKpis(
  currentRows: GoogleAdsCampaignDailyRow[],
  previousRows: GoogleAdsCampaignDailyRow[],
  leadRows: PpcLeadSummaryRow[],
  previousLeadRows: PpcLeadSummaryRow[],
  revenueRows: RevenueSummaryRow[],
  trackingRows: PpcTrackingSummaryRow[],
): KpiItem[] {
  const current = totals(currentRows)
  const previous = totals(previousRows)
  const currentClicks = Math.max(current.clicks, livePaidClickIds(trackingRows).size)
  const leads = leadRows.length
  const previousLeads = previousLeadRows.length
  const qualified = leadRows.filter((lead) => QUALIFIED_STAGES.has(normalizeStation(lead.station))).length
  const previousQualified = previousLeadRows.filter((lead) => QUALIFIED_STAGES.has(normalizeStation(lead.station))).length
  const pipelineValue = revenueRows.reduce((sum, row) => sum + numberValue(row.amount), 0)
  const dealCount = new Set(revenueRows.map((row) => text(row.deal_id)).filter(Boolean)).size

  return [
    { lab: 'Impressions', val: current.impressions, fmt: 'num', delta: pctDelta(current.impressions, previous.impressions), good: true },
    { lab: 'Clicks', val: currentClicks, fmt: 'num', delta: pctDelta(currentClicks, previous.clicks), good: true },
    { lab: 'Leads', val: leads, fmt: 'num', delta: pctDelta(leads, previousLeads), good: true },
    { lab: 'Qualified', val: qualified, fmt: 'num', delta: pctDelta(qualified, previousQualified), good: true },
    { lab: 'Cost / Lead', val: safeCost(current.spend, leads), fmt: 'usd', delta: pctDelta(safeCost(current.spend, leads), safeCost(previous.spend, previousLeads)), good: false },
    { lab: 'Cost / Deal', val: safeCost(current.spend, dealCount), fmt: 'usd', delta: 0, good: dealCount > 0 },
    { lab: 'Pipeline Assignment Value', val: pipelineValue, fmt: 'k', delta: 0, good: true },
  ]
}

function eventTimestamp(row: Pick<PpcTrackingSummaryRow, 'event_time' | 'created_at'>): string {
  return row.event_time || row.created_at || new Date(0).toISOString()
}

function dateLabel(value: string | null): { date: string; dateL: string; time: string } {
  const date = value ? new Date(value) : new Date()
  const day = chicagoDate(date)
  const today = chicagoDate()
  const yesterday = addDays(today, -1)
  return {
    date: day === today ? 'today' : day === yesterday ? 'yesterday' : day,
    dateL: day === today
      ? 'Today'
      : day === yesterday
        ? 'Yesterday'
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    time: date.toLocaleTimeString('en-US', { timeZone: CHICAGO_TIME_ZONE, hour: 'numeric', minute: '2-digit' }),
  }
}

function displayText(value: unknown, fallback = '--'): string {
  const cleaned = text(value)
  if (!cleaned) return fallback
  return cleaned
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function trackingAttribution(row: PpcTrackingSummaryRow): Record<string, unknown> {
  const payload = record(row.payload)
  const attribution = record(payload.attribution)
  return {
    ...attribution,
    source: row.utm_source || row.traffic_source || attribution.source,
    medium: row.utm_medium || attribution.medium,
    campaign: row.campaign || row.utm_campaign || attribution.campaign,
    utm_campaign: row.utm_campaign || attribution.utm_campaign,
    utm_term: row.utm_term || attribution.utm_term,
    utm_content: row.utm_content || attribution.utm_content,
    gclid: row.gclid || attribution.gclid || payload.gclid,
    gbraid: row.gbraid || attribution.gbraid || payload.gbraid,
    wbraid: row.wbraid || attribution.wbraid || payload.wbraid,
    landingUrl: row.page_location || attribution.landingUrl || payload.landingUrl,
    referrer: row.page_referrer || attribution.referrer || payload.referrer,
  }
}

function clickIdFromTracking(row: PpcTrackingSummaryRow): string {
  const attribution = trackingAttribution(row)
  return text(attribution.gclid) || text(attribution.gbraid) || text(attribution.wbraid)
}

function campaignFromAttribution(attribution: Record<string, unknown>): string {
  return text(attribution.utm_campaign) || text(attribution.campaign) || 'Search 2026'
}

type KeywordResolution = {
  keyword: string
  mapped: boolean
  reason?: 'app_ios_click' | 'not_captured'
}

function resolveKeyword(attribution: Record<string, unknown> | null | undefined): KeywordResolution {
  const source = attribution ?? {}
  const keyword = text(source.utm_term) || text(source.keyword)
  if (keyword) return { keyword, mapped: true }

  const hasGclid = Boolean(text(source.gclid))
  const hasAppClick = Boolean(text(source.gbraid) || text(source.wbraid))
  if (hasAppClick && !hasGclid) {
    return { keyword: 'Keyword n/a (app/iOS click)', mapped: false, reason: 'app_ios_click' }
  }

  return { keyword: 'Keyword not captured', mapped: false, reason: 'not_captured' }
}

function pathFromTracking(row: PpcTrackingSummaryRow, attribution: Record<string, unknown>): string {
  if (row.page_path) return row.page_path
  const landing = text(attribution.landingUrl)
  if (landing) {
    try {
      return new URL(landing).pathname || '/ppc'
    } catch {
      return landing.startsWith('/') ? landing : '/ppc'
    }
  }
  return '/ppc'
}

function sessionKey(row: PpcTrackingSummaryRow): string {
  return clickIdFromTracking(row) || text(row.session_id) || text(row.visitor_id) || row.id
}

function sessionDevice(rows: PpcTrackingSummaryRow[]): string {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    const payload = record(row?.payload)
    const device = record(payload.device)
    const browser = record(payload.browser)
    const platform = text(device.device_platform) || text(browser.platform)
    const type = text(device.device_type)
    const mobile = device.device_mobile
    const fallbackType = mobile === true ? 'mobile' : mobile === false ? 'desktop' : ''
    const label = [platform, type || fallbackType].filter(Boolean).join(' / ')
    if (label) return label
  }
  return 'Unknown device'
}

function latestRowValue(rows: PpcTrackingSummaryRow[], key: keyof PpcTrackingSummaryRow): string {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = text(rows[index]?.[key])
    if (value) return value
  }
  return ''
}

function latestPayloadValue(rows: PpcTrackingSummaryRow[], key: string): string {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = text(record(rows[index]?.payload)[key])
    if (value) return value
  }
  return ''
}

function timelineLabel(value: string): string {
  if (value === 'asap') return 'ASAP (under 30 days)'
  if (value === '60-days') return '30-60 days'
  if (value === 'flexible') return 'Flexible'
  if (value === 'exploring') return 'Just exploring'
  return displayText(value, 'Not captured')
}

function conditionLabel(value: string): string {
  if (value === 'good') return 'Move-in ready'
  if (value === 'needs-work') return 'Needs work'
  if (value === 'major-repair') return 'Major repairs'
  if (value === 'vacant') return 'Vacant'
  return displayText(value, 'Not captured')
}

function auctionStatusLabel(value: string): string {
  if (value === 'yes') return 'Auction: yes'
  if (value === 'no') return 'Auction: no'
  if (value === 'not-sure') return 'Auction: not sure'
  return displayText(value, '')
}

function maxScrollDepth(rows: PpcTrackingSummaryRow[]): number {
  return Math.max(0, ...rows.map((row) => {
    const payload = record(row.payload)
    return integer(payload.percent_scrolled || payload.scroll_depth)
  }))
}

function contactFieldsFromEvents(rows: PpcTrackingSummaryRow[]): string[] {
  const fields = new Set<string>()
  for (const row of rows) {
    const name = text(row.event_name)
    const payload = record(row.payload)
    const field = text(payload.field_name)
    if (name === 'contact_field_started' && field) fields.add(field)
    if (name === 'address_selected' || payload.has_address === true) fields.add('address')
    if (payload.has_name === true) fields.add('name')
    if (payload.has_phone === true) fields.add('phone')
    if (payload.has_email === true) fields.add('email')
  }
  return ['address', 'name', 'phone', 'email'].filter((field) => fields.has(field))
}

function sessionProgress(rows: PpcTrackingSummaryRow[], converted: boolean): number {
  if (converted) return 8
  const names = new Set(rows.map((row) => text(row.event_name)))
  const maxStep = Math.max(0, ...rows.map((row) => row.form_step ?? 0))
  if (maxStep >= 4 || names.has('contact_field_started') || names.has('address_selected') || names.has('address_typed') || names.has('step_3_field_completed') || names.has('lead_stage3_completed')) return 7
  if (maxStep >= 3 || latestRowValue(rows, 'condition_raw') || names.has('condition_selected') || names.has('lead_quiz_qualified')) return 6
  if (maxStep >= 2 || latestRowValue(rows, 'timeline_raw') || names.has('timeline_selected') || names.has('auction_status_selected')) return 5
  if (latestRowValue(rows, 'situation_raw') || names.has('situation_selected')) return 4
  if (names.has('scroll_depth_reached') || names.has('cta_click') || names.has('nav_click')) return 3
  if (names.has('ppc_visit_started')) return 2
  return 1
}

function sessionDrop(rows: PpcTrackingSummaryRow[]): PaidSessionRow['drop'] {
  const names = new Set(rows.map((row) => text(row.event_name)))
  if (names.has('form_error')) return 'invalid_phone'
  if (names.has('scroll_depth_reached')) return 'scroll_bottom'
  if (names.has('nav_click')) return 'back'
  if (names.has('cta_click')) return 'idle'
  return 'idle'
}

function buildPaidSessions(rows: PpcTrackingSummaryRow[]): PaidSessionRow[] {
  const groups = new Map<string, PpcTrackingSummaryRow[]>()
  for (const row of rows) {
    if (!clickIdFromTracking(row)) continue
    const key = sessionKey(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const ordered = [...group].sort((a, b) => Date.parse(eventTimestamp(a)) - Date.parse(eventTimestamp(b)))
      const first = ordered[0]!
      const last = ordered[ordered.length - 1]!
      const attribution = ordered.reduce<Record<string, unknown>>(
        (acc, row) => ({ ...acc, ...trackingAttribution(row) }),
        {},
      )
      const leadId = [...ordered].reverse().map((row) => row.lead_id).find(Boolean) ?? null
      const converted = Boolean(leadId) || ordered.some((row) => text(row.event_name) === 'lead_submitted' || text(row.form_status) === 'submitted')
      const labels = dateLabel(eventTimestamp(last))
      const clickId = clickIdFromTracking(first) || key
      const firstTime = Date.parse(eventTimestamp(first))
      const lastTime = Date.parse(eventTimestamp(last))
      const durationSec = Number.isFinite(firstTime) && Number.isFinite(lastTime)
        ? Math.max(0, Math.round((lastTime - firstTime) / 1000))
        : 0
      const timeline = timelineLabel(latestRowValue(ordered, 'timeline_raw'))
      const condition = conditionLabel(latestRowValue(ordered, 'condition_raw'))
      const auctionStatus = auctionStatusLabel(latestPayloadValue(ordered, 'auctionStatus'))
      const keyword = resolveKeyword(attribution)

      return {
        id: key,
        ...labels,
        campaign: campaignFromAttribution(attribution),
        gclid: clickId,
        kw: keyword.keyword,
        kwMapped: keyword.mapped,
        sub: displayText(latestRowValue(ordered, 'situation_raw'), 'Unmapped situation'),
        timeline,
        condition,
        auctionStatus,
        contactFields: contactFieldsFromEvents(ordered),
        land: pathFromTracking(first, attribution),
        progress: sessionProgress(ordered, converted),
        converted,
        leadId,
        drop: converted ? null : sessionDrop(ordered),
        city: displayText(record(last.payload).city || record(last.payload).market, 'KC metro'),
        device: sessionDevice(ordered),
        ref: text(last.page_referrer) || text(attribution.referrer) || 'google.com/search',
        loadMs: Math.max(0, integer(record(last.payload).load_ms || record(last.payload).lcp_ms || record(last.payload).loadMs)),
        durationSec,
        scrollDepth: maxScrollDepth(ordered),
      } satisfies PaidSessionRow & { kwMapped: boolean }
    })
    .sort((a, b) => Date.parse(`${b.date === 'today' ? chicagoDate() : b.date === 'yesterday' ? addDays(chicagoDate(), -1) : b.date} ${b.time}`) - Date.parse(`${a.date === 'today' ? chicagoDate() : a.date === 'yesterday' ? addDays(chicagoDate(), -1) : a.date} ${a.time}`))
    .slice(0, 50)
}

function stageProgress(station: string | null): number {
  const value = normalizeStation(station)
  if (value === 'closed_won') return 11
  if (value === 'under_contract') return 10
  if (value === 'offer_made') return 9
  if (value === 'appointment_set') return 8
  if (value === 'qualified') return 7
  if (value === 'connected') return 6
  if (value === 'attempted' || value === 'contacted') return 5
  return 4
}

function leadVerdict(score: number): LeadRow['verdict'] {
  if (score >= 68) return 'FAVORITE'
  if (score >= 45) return 'WATCH'
  return 'FOOL'
}

function buildLeadRows(
  leadRows: PpcLeadSummaryRow[],
  trackingRows: PpcTrackingSummaryRow[],
  outboxRows: PpcOutboxSummaryRow[],
  activityRows: PpcActivitySummaryRow[],
  revenueRows: RevenueSummaryRow[],
): LeadRow[] {
  const trackingByLead = new Map<string, PpcTrackingSummaryRow[]>()
  for (const row of trackingRows) {
    if (!row.lead_id) continue
    trackingByLead.set(row.lead_id, [...(trackingByLead.get(row.lead_id) ?? []), row])
  }

  const outboxByLead = new Map<string, PpcOutboxSummaryRow[]>()
  for (const row of outboxRows) {
    if (!row.lead_id) continue
    outboxByLead.set(row.lead_id, [...(outboxByLead.get(row.lead_id) ?? []), row])
  }

  return leadRows
    .filter((lead) => isExternalLeadRow(lead, activityRows))
    .map((lead) => {
      const linkedTracking = trackingByLead.get(lead.id) ?? []
      const linkedOutbox = outboxByLead.get(lead.id) ?? []
      const firstTracking = linkedTracking[0] ?? null
      const trackingAttributionValue = firstTracking ? trackingAttribution(firstTracking) : {}
      const outboxAttribution = record(linkedOutbox[0]?.attribution)
      const attribution = { ...outboxAttribution, ...trackingAttributionValue }
      const score = Math.max(0, Math.min(100, integer(lead.opportunity_score) || (QUALIFIED_STAGES.has(normalizeStation(lead.station)) ? 72 : 48)))
      const activities = activityRows.filter((activity) => activity.lead_id === lead.id)
      const dials = activities.filter((activity) => /call|dial|sms|phone/i.test(`${activity.activity_type || ''} ${activity.description || ''}`)).length
      const connects = activities.filter((activity) => /connect|answered|conversation/i.test(`${activity.description || ''} ${JSON.stringify(activity.metadata || {})}`)).length
      const created = lead.created_at ? new Date(lead.created_at) : new Date()
      const days = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000))
      const spread = revenueRows
        .filter((row) => row.deal_id === lead.id)
        .reduce((sum, row) => sum + numberValue(row.amount), 0)

      const keyword = resolveKeyword(attribution)

      return {
        id: lead.id,
        name: text(lead.full_name) || 'PPC Lead',
        county: [lead.county, lead.city].map(text).filter(Boolean).join(' / ') || 'KC metro',
        prop: text(lead.classification) || displayText(lead.property_address, 'Property details pending'),
        campaign: campaignFromAttribution(attribution),
        kw: keyword.keyword,
        kwMapped: keyword.mapped,
        land: firstTracking ? pathFromTracking(firstTracking, attribution) : '/ppc',
        progress: stageProgress(lead.station),
        score,
        verdict: leadVerdict(score),
        spread,
        days,
        dials,
        connects,
        talk: 0,
        spend: 0,
        ts0: created.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      } satisfies LeadRow & { kwMapped: boolean }
    })
    .filter((lead) => trackingByLead.has(String(lead.id)) || outboxByLead.has(String(lead.id)) || PPC_LEAD_SOURCES.includes(text(leadRows.find((row) => row.id === lead.id)?.source)))
    .sort((a, b) => a.days - b.days)
    .slice(0, 24)
}

function eventLabel(name: string | null): string {
  const value = text(name)
  if (value === 'lead_submitted') return 'Lead Submitted'
  if (value === 'qualified_lead') return 'Qualified Lead'
  if (value === 'lead_stage3_completed') return 'Step 3 Complete'
  if (value === 'appointment_booked') return 'Appointment Booked'
  if (value === 'call_connected_60s') return 'Call 60+ Seconds'
  if (value === 'call_connected_2m') return 'Call 2+ Minutes'
  if (value === 'call_connected_5m') return 'Call 5+ Minutes'
  return displayText(value, 'Conversion')
}

function compactClickId(value: unknown): string {
  const cleaned = text(value)
  if (!cleaned) return '--'
  if (cleaned.length <= 18) return cleaned
  return `${cleaned.slice(0, 12)}...${cleaned.slice(-4)}`
}

function outboxStatus(row: PpcOutboxSummaryRow): string {
  const payload = record(row.payload)
  if (payload.dryRun === true || payload.dry_run === true || payload.validateOnly === true || payload.validate_only === true) return 'Dry run'
  const status = text(row.status).toLowerCase() || 'pending'
  if (!isGoogleAdsExportablePpcEvent(row.event_name)) return 'Website/GTM only'
  if (isGoogleAdsApprovalRequiredPpcEvent(row.event_name, payload) && row.approved_for_google_ads === false && ['pending', 'processing', 'failed'].includes(status)) {
    return 'Awaiting approval'
  }
  return displayText(status)
}

function buildOutboxRows(outboxRows: PpcOutboxSummaryRow[], leadRows: PpcLeadSummaryRow[]): OutboxRow[] {
  const leadsById = new Map(leadRows.map((lead) => [lead.id, lead]))
  return outboxRows
    .map((row) => {
      const attribution = record(row.attribution)
      const payload = record(row.payload)
      const lead = row.lead_id ? leadsById.get(row.lead_id) : null
      const eventTime = row.event_time || row.created_at || new Date().toISOString()
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(eventTime).getTime()) / 86_400_000))
      const exportable = isGoogleAdsExportablePpcEvent(row.event_name)
      const approvalRequired = isGoogleAdsApprovalRequiredPpcEvent(row.event_name, payload)
      const clickId = text(row.click_id)
        || text(attribution.gclid)
        || text(attribution.gbraid)
        || text(attribution.wbraid)
        || text(attribution.click_id)
      const clickIdType = text(row.click_id_type)
        || (text(attribution.gclid) ? 'gclid' : text(attribution.gbraid) ? 'gbraid' : text(attribution.wbraid) ? 'wbraid' : '--')

      const keyword = resolveKeyword(attribution)

      return {
        id: row.id,
        leadId: row.lead_id,
        leadName: text(lead?.full_name) || 'Unlinked conversion',
        event: eventLabel(row.event_name),
        category: displayText(row.event_category, 'Conversion'),
        status: outboxStatus(row),
        approved: row.approved_for_google_ads === true,
        role: displayText(row.optimization_role, 'Secondary'),
        clickId: compactClickId(clickId),
        clickIdType,
        campaign: campaignFromAttribution(attribution),
        keyword: keyword.keyword,
        keywordMapped: keyword.mapped,
        value: numberValue(row.conversion_value),
        attempts: integer(row.attempts),
        lastError: text(row.last_error) || null,
        dryRun: payload.dryRun === true || payload.dry_run === true || payload.validateOnly === true || payload.validate_only === true,
        exportable,
        approvalRequired,
        exportNote: exportable ? null : nonExportablePpcEventReason(row.event_name),
        sentAt: row.sent_at,
        eventTime,
        ageDays,
      } satisfies OutboxRow & { keywordMapped: boolean }
    })
    .sort((a, b) => Date.parse(b.eventTime) - Date.parse(a.eventTime))
    .slice(0, 50)
}

async function fetchRows(period: MarketingPeriod) {
  const range = rangeForPeriod(period)
  const previousRange = previousRangeForPeriod(period, range)
  const db = supabaseAdmin()

  const [
    { data: campaignRows, error: campaignError },
    { data: previousCampaignRows, error: previousCampaignError },
    { data: searchRows, error: searchError },
    { data: trackingRows, error: trackingError },
    { data: leadRows, error: leadError },
    { data: previousLeadRows, error: previousLeadError },
    { data: outboxRows, error: outboxError },
    { data: activityRows, error: activityError },
    { data: revenueRows, error: revenueError },
    { data: syncRunRows, error: syncRunError },
  ] = await Promise.all([
    db.from('google_ads_campaign_daily').select('date,campaign_id,campaign_name,impressions,clicks,cost_micros,conversions,all_conversions,imported_at').gte('date', range.since).lte('date', range.until).order('date', { ascending: true }),
    db.from('google_ads_campaign_daily').select('date,campaign_id,campaign_name,impressions,clicks,cost_micros,conversions,all_conversions,imported_at').gte('date', previousRange.since).lte('date', previousRange.until),
    db.from('google_ads_search_term_daily').select('date,campaign_id,campaign_name,ad_group_id,ad_group_name,search_term,keyword_text,keyword_match_type,impressions,clicks,cost_micros,conversions,all_conversions,imported_at').gte('date', range.since).lte('date', range.until).order('clicks', { ascending: false }).limit(500),
    db.from('ppc_tracking_events').select('id,event_id,event_name,event_category,event_time,session_id,visitor_id,lead_id,page_path,page_location,page_referrer,traffic_source,campaign,utm_source,utm_medium,utm_campaign,utm_term,utm_content,gclid,gbraid,wbraid,gad_source,gad_campaignid,gad_adgroupid,form_step,form_status,situation_raw,timeline_raw,condition_raw,phone_number,is_test,payload,created_at').gte('event_time', isoStart(range.since)).lt('event_time', isoAfter(range.until)).order('event_time', { ascending: true }).limit(5000),
    db.from('leads').select('id,full_name,source,station,priority,property_address,city,county,classification,opportunity_score,created_at').in('source', PPC_LEAD_SOURCES).gte('created_at', isoStart(range.since)).lt('created_at', isoAfter(range.until)).limit(2000),
    db.from('leads').select('id,full_name,source,station,priority,property_address,city,county,classification,opportunity_score,created_at').in('source', PPC_LEAD_SOURCES).gte('created_at', isoStart(previousRange.since)).lt('created_at', isoAfter(previousRange.until)).limit(2000),
    db.from('ppc_conversion_outbox').select('id,event_name,event_category,dedupe_key,status,approved_for_google_ads,optimization_role,event_time,lead_id,conversion_value,click_id,click_id_type,attribution,payload,attempts,last_error,sent_at,created_at').gte('event_time', isoStart(range.since)).lt('event_time', isoAfter(range.until)).limit(2000),
    db.from('lead_activities').select('lead_id,activity_type,description,metadata,created_at').gte('created_at', isoStart(range.since)).lt('created_at', isoAfter(range.until)).limit(5000),
    db.from('revenue_transactions').select('deal_id,amount').gte('date', range.since).lte('date', range.until).limit(2000),
    db.from('google_ads_reporting_sync_runs').select('status,started_at,finished_at,error').order('started_at', { ascending: false }).limit(1),
  ])

  const firstError = campaignError || previousCampaignError || searchError || trackingError || leadError || previousLeadError || outboxError || activityError || revenueError || syncRunError
  if (firstError) throw new Error(firstError.message)

  const cleanTrackingRows = ((trackingRows ?? []) as PpcTrackingSummaryRow[]).filter(isExternalTrackingRow)
  const cleanOutboxRows = ((outboxRows ?? []) as PpcOutboxSummaryRow[]).filter(isExternalOutboxRow)
  const cleanActivityRows = (activityRows ?? []) as PpcActivitySummaryRow[]

  return {
    range,
    campaignRows: (campaignRows ?? []) as GoogleAdsCampaignDailyRow[],
    previousCampaignRows: (previousCampaignRows ?? []) as GoogleAdsCampaignDailyRow[],
    searchRows: (searchRows ?? []) as GoogleAdsSearchTermDailyRow[],
    trackingRows: cleanTrackingRows,
    leadRows: ((leadRows ?? []) as PpcLeadSummaryRow[]).filter((lead) => isExternalLeadRow(lead, cleanActivityRows)),
    previousLeadRows: ((previousLeadRows ?? []) as PpcLeadSummaryRow[]).filter((lead) => isExternalLeadRow(lead, cleanActivityRows)),
    outboxRows: cleanOutboxRows,
    activityRows: cleanActivityRows,
    revenueRows: (revenueRows ?? []) as RevenueSummaryRow[],
    latestSyncRun: ((syncRunRows ?? []) as GoogleAdsSyncRunRow[])[0] ?? null,
  }
}

function latestImportLabel(rows: GoogleAdsCampaignDailyRow[]): string {
  if (rows.length === 0) return 'LIVE • no Google Ads rows'
  return 'LIVE • 60s dashboard / 10m Ads sync'
}

function latestIso(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (!value) continue
    const time = Date.parse(value)
    if (Number.isNaN(time)) continue
    if (!latest || time > Date.parse(latest)) latest = value
  }
  return latest
}

function buildFreshness(
  generatedAt: string,
  campaignRows: GoogleAdsCampaignDailyRow[],
  searchRows: GoogleAdsSearchTermDailyRow[],
  trackingRows: PpcTrackingSummaryRow[],
  latestSyncRun: GoogleAdsSyncRunRow | null,
): AdsCommandFreshness {
  return {
    dashboardGeneratedAt: generatedAt,
    liveTrackingUpdatedAt: latestIso(trackingRows.map((row) => row.event_time || row.created_at)),
    googleAdsImportedAt: latestIso([
      ...campaignRows.map((row) => row.imported_at),
      ...searchRows.map((row) => row.imported_at),
      latestSyncRun?.finished_at,
    ]),
    googleAdsSyncStatus: latestSyncRun?.status ?? null,
    googleAdsSyncFinishedAt: latestSyncRun?.finished_at ?? null,
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const email = await getCurrentUserEmail()
  const allowLocalPreview = process.env.NODE_ENV !== 'production'
  const previewToken = process.env.ADS_COMMAND_PREVIEW_TOKEN?.trim()
  const allowSharedPreview = process.env.VERCEL_ENV === 'preview'
    && Boolean(previewToken)
    && url.searchParams.get('previewToken') === previewToken

  if (!email && !allowLocalPreview && !allowSharedPreview) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  try {
    const period = readPeriod(url.searchParams.get('period'))
    const rows = await fetchRows(period)
    const series = buildSeries(rows.campaignRows, rows.leadRows, rows.trackingRows, rows.range)
    const leadRowsForResponse = buildLeadRows(rows.leadRows, rows.trackingRows, rows.outboxRows, rows.activityRows, rows.revenueRows)
    const generatedAt = new Date().toISOString()
    const response: AdsCommandResponse = {
      source: 'live',
      generatedAt,
      syncedLabel: latestImportLabel(rows.campaignRows),
      freshness: buildFreshness(generatedAt, rows.campaignRows, rows.searchRows, rows.trackingRows, rows.latestSyncRun),
      period,
      range: rows.range,
      kpi: buildKpis(rows.campaignRows, rows.previousCampaignRows, rows.leadRows, rows.previousLeadRows, rows.revenueRows, rows.trackingRows),
      series,
      campaigns: groupCampaigns(rows.campaignRows, rows.trackingRows, rows.outboxRows, leadRowsForResponse),
      keywords: buildKeywords(rows.searchRows, leadRowsForResponse, rows.campaignRows),
      negatives: rows.searchRows.length ? buildNegatives(rows.searchRows) : [],
      funnel: buildFunnel(rows.campaignRows, rows.trackingRows, rows.leadRows),
      callBreakdown: buildCallBreakdown(rows.trackingRows, rows.outboxRows),
      leads: leadRowsForResponse,
      outbox: buildOutboxRows(rows.outboxRows, rows.leadRows),
      paidSessions: buildPaidSessions(rows.trackingRows),
    }

    return NextResponse.json(response, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[marketing/ads-command] failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load Ads Command data' },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
