import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  cleanJsonRecord,
  type PpcClickIdType,
  type PpcConversionCategory,
  type PpcConversionEventName,
  type PpcOptimizationRole,
} from '@/lib/ppc/conversion-outbox'
import { resolveGoogleAdsQualityScore } from '@/lib/ppc/conversion-approval'
import {
  GOOGLE_ADS_CLEANUP_ONLY_PPC_EVENT_NAMES,
  GOOGLE_ADS_FACTUAL_PPC_EVENT_NAMES,
  GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES,
  isGoogleAdsApprovalRequiredPpcEvent,
  isGoogleAdsExportablePpcEvent,
  isGoogleAdsFactualPpcEvent,
  nonExportablePpcEventReason,
} from '@/lib/ppc/exportable-events'
import { ppcCampaignNameForContext, ppcCampaignForPageLocation } from '@/lib/ppc/campaigns'
import { readUserIdentifiers } from '@/lib/ppc/enhanced-conversions'
import { safeSendSMS } from '@/lib/safe-communications'

const DEFAULT_BATCH_SIZE = 25
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_GOOGLE_ADS_API_VERSION = 'v24'
const DEFAULT_STAPE_REQUEST_PATH = '/data'
const GOOGLE_ADS_CALL_CONVERSION_MIN_AGE_MS = 12 * 60 * 60 * 1000
const PPC_CONVERSION_PROCESSING_LOCK_TTL_MS = 10 * 60 * 1000
const GA4_MEASUREMENT_PROTOCOL_ENDPOINT = 'https://www.google-analytics.com/mp/collect'
const GA4_MEASUREMENT_PROTOCOL_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect'
const OPENAI_ADS_CONVERSIONS_ENDPOINT = 'https://bzr.openai.com/v1/events'
const OPENAI_ADS_MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000
const OPENAI_ADS_MAX_FUTURE_SKEW_MS = 10 * 60 * 1000
const GOOGLE_ADS_WORKER_CANDIDATE_EVENT_NAMES = [
  ...GOOGLE_ADS_FACTUAL_PPC_EVENT_NAMES,
  ...GOOGLE_ADS_CLEANUP_ONLY_PPC_EVENT_NAMES,
]
const OPENAI_ADS_EXPORTABLE_PPC_EVENT_NAMES: PpcConversionEventName[] = [
  'lead_submitted',
  'qualified_lead',
  'appointment_booked',
  'call_connected_60s',
  'call_connected_2m',
  'call_connected_5m',
]
const OPENAI_ADS_EXPORTABLE_PPC_EVENTS = new Set<string>(OPENAI_ADS_EXPORTABLE_PPC_EVENT_NAMES)
const GA4_EXPORTABLE_PPC_EVENT_NAMES: PpcConversionEventName[] = OPENAI_ADS_EXPORTABLE_PPC_EVENT_NAMES
const GA4_EXPORTABLE_PPC_EVENTS = new Set<string>(GA4_EXPORTABLE_PPC_EVENT_NAMES)

type Env = Record<string, string | undefined>

export type PpcConversionOutboxExportStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'dead_letter'
  | 'skipped'

export type PpcConversionOutboxExportRow = {
  id: string
  event_name: PpcConversionEventName
  event_category: PpcConversionCategory
  destination: 'google_ads'
  dedupe_key: string
  approved_for_google_ads: boolean
  status: PpcConversionOutboxExportStatus
  optimization_role: PpcOptimizationRole
  lead_id: string | null
  manifest_id: string | null
  activity_id: string | null
  conversion_value: number | string | null
  currency: string | null
  event_time: string
  click_id: string | null
  click_id_type: PpcClickIdType | null
  attribution: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  attempts: number
  last_error: string | null
  locked_at: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export type DestinationResult = {
  destination: 'google_ads' | 'stape' | 'openai_ads' | 'ga4'
  status: 'sent' | 'skipped' | 'failed' | 'would_send'
  detail?: string
}

export type RowExportResult = {
  id: string
  eventName: PpcConversionEventName
  status: 'sent' | 'skipped' | 'failed' | 'pending'
  destinations: DestinationResult[]
}

export type PpcConversionExportResult = {
  ok: boolean
  dryRun: boolean
  configured: boolean
  scanned: number
  claimed: number
  repairedKnownSkips: number
  sent: number
  skipped: number
  failed: number
  pending: number
  missingConfig: string[]
  results: RowExportResult[]
}

export type PpcConversionExportConfigHealth = {
  configured: boolean
  mode: 'all' | 'google_ads_and_stape' | 'google_ads_only' | 'stape_only' | 'openai_ads_only' | 'ga4_only' | 'mixed' | 'not_configured'
  enabledDestinations: DestinationResult['destination'][]
  googleAds: {
    enabled: boolean
    ready: boolean
    customerId: string | null
    apiVersion: string | null
    missingConfig: string[]
    configuredActionMappings: PpcConversionEventName[]
    missingActionMappings: PpcConversionEventName[]
  }
  stape: {
    enabled: boolean
    ready: boolean
    endpointHost: string | null
    previewHeaderConfigured: boolean
    missingConfig: string[]
  }
  openaiAds: {
    enabled: boolean
    ready: boolean
    pixelIdConfigured: boolean
    apiKeyConfigured: boolean
    missingConfig: string[]
  }
  ga4: {
    enabled: boolean
    ready: boolean
    measurementIdConfigured: boolean
    apiSecretConfigured: boolean
    missingConfig: string[]
  }
  warnings: string[]
}

type OutboxStore = {
  listRows(limit: number, now: Date): Promise<PpcConversionOutboxExportRow[]>
  claimRows(limit: number, now: Date): Promise<PpcConversionOutboxExportRow[]>
  repairKnownSkippedRows?(now: Date): Promise<number>
  markSent(row: PpcConversionOutboxExportRow, summary: Record<string, unknown>, now: Date): Promise<void>
  markSkipped(row: PpcConversionOutboxExportRow, reason: string, summary: Record<string, unknown>, now: Date): Promise<void>
  markFailed(row: PpcConversionOutboxExportRow, reason: string, summary: Record<string, unknown>, now: Date): Promise<void>
}

type QualifiedLeadExportAlertResult = {
  attempted: boolean
  success: boolean
  reason?: string
  sid?: string
  status?: string
  toLast4?: string
  hasUserIdentifiers?: boolean
  sentAt?: string
  error?: string
}

type PpcConversionExportNotifier = {
  notifyQualifiedLeadExport(
    row: PpcConversionOutboxExportRow,
    destinations: DestinationResult[],
    now: Date,
  ): Promise<QualifiedLeadExportAlertResult | null>
}

export type PpcConversionExportOptions = {
  dryRun?: boolean
  batchSize?: number
  maxAttempts?: number
  validateOnly?: boolean
  now?: Date
  env?: Env
}

type PpcConversionExportDeps = {
  store?: OutboxStore
  fetch?: typeof fetch
  notifier?: PpcConversionExportNotifier
}

export type GoogleAdsConfig = {
  apiVersion: string
  customerId: string
  loginCustomerId: string | null
  developerToken: string
  clientId: string
  clientSecret: string
  refreshToken: string | null
  refreshTokenUserEmail: string | null
  adUserDataConsent: string | null
  conversionActions: Partial<Record<PpcConversionEventName, string>>
}

type StapeConfig = {
  endpoint: string
  previewHeader: string | null
  origin: string
}

type OpenAIAdsConfig = {
  pixelId: string
  apiKey: string
}

type Ga4Config = {
  measurementId: string
  apiSecret: string
}

type GoogleAdsUploadPlan =
  | { kind: 'click'; conversion: Record<string, unknown> }
  | { kind: 'call'; conversion: Record<string, unknown> }
  | { kind: 'skip'; reason: string; hardFailure?: boolean }

type OpenAIAdsUploadPlan =
  | { kind: 'event'; event: Record<string, unknown> }
  | { kind: 'skip'; reason: string; hardFailure?: boolean }

type Ga4UploadPlan =
  | { kind: 'event'; body: Record<string, unknown>; eventName: string }
  | { kind: 'skip'; reason: string; hardFailure?: boolean }

class SupabaseOutboxStore implements OutboxStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly maxAttempts: number,
  ) {}

  async listRows(limit: number, now: Date): Promise<PpcConversionOutboxExportRow[]> {
    return this.queryCandidateRows(limit, now)
  }

  async claimRows(limit: number, now: Date): Promise<PpcConversionOutboxExportRow[]> {
    const candidates = await this.queryCandidateRows(limit, now)
    const claimed: PpcConversionOutboxExportRow[] = []

    for (const row of candidates) {
      let query = this.client
        .from('ppc_conversion_outbox')
        .update({
          status: 'processing',
          locked_at: now.toISOString(),
          last_error: null,
          attempts: Number(row.attempts ?? 0) + 1,
        })
        .eq('id', row.id)

      if (row.status === 'processing') {
        query = query.eq('status', 'processing')
        query = row.locked_at ? query.eq('locked_at', row.locked_at) : query.is('locked_at', null)
      } else {
        query = query.in('status', ['pending', 'failed'])
      }

      const { data, error } = await query.select('*').maybeSingle()

      if (error) {
        console.error('[ppc/conversion-exporter] claim failed', error)
        continue
      }
      if (data) claimed.push(data as PpcConversionOutboxExportRow)
    }

    return claimed
  }

  async markSent(row: PpcConversionOutboxExportRow, summary: Record<string, unknown>, now: Date): Promise<void> {
    await this.updateRow(row, {
      status: 'sent',
      sent_at: now.toISOString(),
      locked_at: null,
      last_error: null,
      payload: mergePayload(row, summary),
    })
  }

  async markSkipped(
    row: PpcConversionOutboxExportRow,
    reason: string,
    summary: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    await this.updateRow(row, {
      status: 'skipped',
      sent_at: null,
      locked_at: null,
      last_error: reason,
      updated_at: now.toISOString(),
      payload: mergePayload(row, summary),
    })
  }

  async markFailed(
    row: PpcConversionOutboxExportRow,
    reason: string,
    summary: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    const attempts = Number(row.attempts ?? 0)
    await this.updateRow(row, {
      status: attempts >= this.maxAttempts ? 'dead_letter' : 'failed',
      locked_at: null,
      last_error: reason,
      updated_at: now.toISOString(),
      payload: mergePayload(row, summary),
    })
  }

  async repairKnownSkippedRows(now: Date): Promise<number> {
    const { data, error } = await this.client
      .from('ppc_conversion_outbox')
      .select('*')
      .eq('status', 'dead_letter')
      .eq('event_category', 'call')
      .ilike('last_error', '%caller_id%')
      .order('event_time', { ascending: true })
      .limit(25)

    if (error) throw new Error(error.message)

    let repaired = 0
    for (const row of (data ?? []) as PpcConversionOutboxExportRow[]) {
      if (!isUnmatchedGoogleAdsCallUpload(row, row.last_error ?? undefined)) continue

      const detail = googleAdsUnmatchedCallSkipReason()
      await this.updateRow(row, {
        status: 'skipped',
        locked_at: null,
        last_error: detail,
        updated_at: now.toISOString(),
        payload: mergePayload(row, cleanJsonRecord({
          ...rowSummary(row, [{ destination: 'google_ads', status: 'skipped', detail }], now),
          repaired_dead_letter_at: now.toISOString(),
        })),
      })
      repaired += 1
    }

    return repaired
  }

  private async queryCandidateRows(limit: number, now: Date): Promise<PpcConversionOutboxExportRow[]> {
    const { data, error } = await this.client
      .from('ppc_conversion_outbox')
      .select('*')
      .or(`approved_for_google_ads.eq.true,event_name.in.(${GOOGLE_ADS_WORKER_CANDIDATE_EVENT_NAMES.join(',')})`)
      .or(ppcConversionClaimableStatusFilter(now))
      .lt('attempts', this.maxAttempts)
      .order('event_time', { ascending: true })
      .limit(Math.min(100, limit * 3))

    if (error) throw new Error(error.message)
    return ((data ?? []) as PpcConversionOutboxExportRow[])
      .filter((row) => isPpcConversionOutboxClaimable(row, now))
      .filter((row) => isPpcConversionExportReady(row, now))
      .filter((row) => row.approved_for_google_ads || !approvalRequired(row))
      .slice(0, limit)
  }

  private async updateRow(row: PpcConversionOutboxExportRow, values: Record<string, unknown>): Promise<void> {
    const { error } = await this.client
      .from('ppc_conversion_outbox')
      .update(values)
      .eq('id', row.id)

    if (error) {
      console.error('[ppc/conversion-exporter] status update failed', { id: row.id, error })
      throw new Error(error.message)
    }
  }
}

function mergePayload(row: PpcConversionOutboxExportRow, summary: Record<string, unknown>): Record<string, unknown> {
  return cleanJsonRecord({
    ...(row.payload ?? {}),
    export: summary,
  })
}

function last4(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits ? digits.slice(-4) : ''
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/+$/, '')
}

function leadUrl(leadId: string | null): string {
  return leadId ? `${appBaseUrl()}/leads/${leadId}` : appBaseUrl()
}

function rowHasUserIdentifiers(row: PpcConversionOutboxExportRow): boolean {
  const payloadIds = readUserIdentifiers(eventPayload(row))
  return payloadIds.length > 0 || readUserIdentifiers(row.attribution).length > 0
}

function googleAdsWasSent(destinations: DestinationResult[]): boolean {
  return destinations.some((destination) => destination.destination === 'google_ads' && destination.status === 'sent')
}

function shouldNotifyQualifiedLeadExport(row: PpcConversionOutboxExportRow, destinations: DestinationResult[]): boolean {
  return row.event_name === 'qualified_lead' && googleAdsWasSent(destinations)
}

function compactSmsBody(value: string, maxLength = 320): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}

function createDefaultNotifier(client: SupabaseClient): PpcConversionExportNotifier {
  return {
    async notifyQualifiedLeadExport(row, destinations, now) {
      if (!shouldNotifyQualifiedLeadExport(row, destinations)) return null

      const from = process.env.TWILIO_PHONE_NUMBER
      const to = process.env.ERNEST_PHONE || '+18162262552'
      const hasUserIdentifiers = rowHasUserIdentifiers(row)

      if (!from) {
        return {
          attempted: false,
          success: false,
          reason: 'TWILIO_PHONE_NUMBER is not configured',
          hasUserIdentifiers,
        }
      }

      let leadName = text(eventPayload(row).lead_name) || 'Qualified PPC lead'
      let address = text(eventPayload(row).property_address) || text(eventPayload(row).address)

      if (row.lead_id) {
        const { data, error } = await client
          .from('leads')
          .select('full_name, property_address')
          .eq('id', row.lead_id)
          .maybeSingle()

        if (error) {
          console.error('[ppc/conversion-exporter] lead lookup failed for qualified lead SMS', {
            leadId: row.lead_id,
            error,
          })
        }

        const lead = data as { full_name?: string | null; property_address?: string | null } | null
        leadName = text(lead?.full_name) || leadName
        address = text(lead?.property_address) || address
      }

      const clickIdType = row.click_id_type ? row.click_id_type.toUpperCase() : 'ECL-only'
      const identifierStatus = hasUserIdentifiers ? 'ECL IDs present' : 'ECL IDS MISSING'
      const prefix = hasUserIdentifiers ? 'PPC ECL verified' : 'PPC ECL ISSUE'
      const addressPart = address ? ` at ${address}` : ''
      const body = compactSmsBody(
        `${prefix}: ${leadName}${addressPart}. Qualified lead sent to Google Ads. ${identifierStatus}. Click: ${clickIdType}. ${leadUrl(row.lead_id)}`,
      )

      const result = await safeSendSMS({ body, from, to })

      return cleanJsonRecord({
        attempted: true,
        success: result.success,
        sid: result.sid,
        status: result.status,
        error: result.error,
        toLast4: last4(to),
        hasUserIdentifiers,
        sentAt: now.toISOString(),
      }) as QualifiedLeadExportAlertResult
    },
  }
}

async function maybeNotifyQualifiedLeadExport(
  row: PpcConversionOutboxExportRow,
  destinations: DestinationResult[],
  now: Date,
  deps: PpcConversionExportDeps,
): Promise<QualifiedLeadExportAlertResult | null> {
  if (!shouldNotifyQualifiedLeadExport(row, destinations)) return null

  try {
    const notifier = deps.notifier ?? createDefaultNotifier(supabaseAdmin())
    return await notifier.notifyQualifiedLeadExport(row, destinations, now)
  } catch (error) {
    console.error('[ppc/conversion-exporter] qualified lead SMS alert failed', {
      rowId: row.id,
      leadId: row.lead_id,
      error,
    })
    return {
      attempted: true,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      hasUserIdentifiers: rowHasUserIdentifiers(row),
    }
  }
}

function readEnv(env: Env, key: string): string | null {
  const value = env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCustomerId(value: string | null): string | null {
  const digits = value?.replace(/\D/g, '') ?? ''
  return digits || null
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function clampBatchSize(value: unknown): number {
  return Math.max(1, Math.min(100, parsePositiveInt(value, DEFAULT_BATCH_SIZE)))
}

function loadConversionActions(env: Env, customerId: string): Partial<Record<PpcConversionEventName, string>> {
  const actions: Partial<Record<PpcConversionEventName, string>> = {}
  const json = readEnv(env, 'GOOGLE_ADS_CONVERSION_ACTIONS_JSON')
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>
      for (const [eventName, rawValue] of Object.entries(parsed)) {
        if (typeof rawValue === 'string' && rawValue.trim()) {
          actions[eventName as PpcConversionEventName] = normalizeConversionActionResource(rawValue, customerId)
        }
      }
    } catch (error) {
      console.error('[ppc/conversion-exporter] GOOGLE_ADS_CONVERSION_ACTIONS_JSON is invalid JSON', error)
    }
  }

  for (const eventName of PPC_EVENT_NAMES) {
    const envKey = `GOOGLE_ADS_CONVERSION_ACTION_${eventName.toUpperCase()}`
    const value = readEnv(env, envKey)
    if (value) actions[eventName] = normalizeConversionActionResource(value, customerId)
  }

  return actions
}

function normalizeConversionActionResource(value: string, customerId: string): string {
  const trimmed = value.trim()
  if (/^customers\/\d+\/conversionActions\/\d+$/.test(trimmed)) return trimmed
  if (/^\d+$/.test(trimmed)) return `customers/${customerId}/conversionActions/${trimmed}`
  return trimmed
}

export function readGoogleAdsConfig(env: Env): { config: GoogleAdsConfig | null; missing: string[] } {
  const rawCustomerId = readEnv(env, 'GOOGLE_ADS_CUSTOMER_ID')
  const customerId = normalizeCustomerId(rawCustomerId)
  const loginCustomerId = normalizeCustomerId(
    readEnv(env, 'GOOGLE_ADS_LOGIN_CUSTOMER_ID') || readEnv(env, 'GOOGLE_ADS_MANAGER_CUSTOMER_ID'),
  )

  const developerToken = readEnv(env, 'GOOGLE_ADS_DEVELOPER_TOKEN')
  const clientId = readEnv(env, 'GOOGLE_ADS_CLIENT_ID') || readEnv(env, 'GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = readEnv(env, 'GOOGLE_ADS_CLIENT_SECRET') || readEnv(env, 'GOOGLE_OAUTH_CLIENT_SECRET')
  const refreshToken = readEnv(env, 'GOOGLE_ADS_REFRESH_TOKEN')
  const refreshTokenUserEmail = readEnv(env, 'GOOGLE_ADS_REFRESH_TOKEN_USER_EMAIL')

  const missing = ([
    ['GOOGLE_ADS_CUSTOMER_ID', customerId],
    ['GOOGLE_ADS_DEVELOPER_TOKEN', developerToken],
    ['GOOGLE_ADS_CLIENT_ID', clientId],
    ['GOOGLE_ADS_CLIENT_SECRET', clientSecret],
    ['GOOGLE_ADS_REFRESH_TOKEN or GOOGLE_ADS_REFRESH_TOKEN_USER_EMAIL', refreshToken || refreshTokenUserEmail],
  ] as Array<[string, string | null]>)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length || !customerId || !developerToken || !clientId || !clientSecret || (!refreshToken && !refreshTokenUserEmail)) {
    return { config: null, missing }
  }

  return {
    config: {
      apiVersion: readEnv(env, 'GOOGLE_ADS_API_VERSION') || DEFAULT_GOOGLE_ADS_API_VERSION,
      customerId,
      loginCustomerId,
      developerToken,
      clientId,
      clientSecret,
      refreshToken,
      refreshTokenUserEmail,
      adUserDataConsent: readEnv(env, 'GOOGLE_ADS_AD_USER_DATA_CONSENT'),
      conversionActions: loadConversionActions(env, customerId),
    },
    missing: [],
  }
}

function readStapeConfig(env: Env): { config: StapeConfig | null; missing: string[] } {
  const explicitEndpoint = readEnv(env, 'PPC_STAPE_ENDPOINT_URL')
  const domain =
    readEnv(env, 'STAPE_SGTM_DOMAIN') ||
    readEnv(env, 'STAPE_GTM_SERVER_URL') ||
    readEnv(env, 'PPC_STAPE_SGTM_URL')

  if (!explicitEndpoint && !domain) return { config: null, missing: ['PPC_STAPE_ENDPOINT_URL or STAPE_SGTM_DOMAIN'] }

  const endpoint =
    explicitEndpoint ||
    `${domain?.replace(/\/+$/, '')}${readEnv(env, 'STAPE_SGTM_REQUEST_PATH') || DEFAULT_STAPE_REQUEST_PATH}`

  if (!endpoint.startsWith('https://')) return { config: null, missing: ['https Stape endpoint'] }

  return {
    config: {
      endpoint,
      previewHeader: readEnv(env, 'STAPE_SGTM_PREVIEW_HEADER'),
      origin: readEnv(env, 'PPC_STAPE_ORIGIN') || 'https://savingkc.com',
    },
    missing: [],
  }
}

function readOpenAIAdsConfig(env: Env): { config: OpenAIAdsConfig | null; missing: string[] } {
  const pixelId = readEnv(env, 'OPENAI_ADS_PIXEL_ID') || readEnv(env, 'NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID')
  const apiKey = readEnv(env, 'OPENAI_ADS_CONVERSIONS_API_KEY')
  const missing = ([
    ['OPENAI_ADS_PIXEL_ID or NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID', pixelId],
    ['OPENAI_ADS_CONVERSIONS_API_KEY', apiKey],
  ] as Array<[string, string | null]>)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length || !pixelId || !apiKey) return { config: null, missing }
  return { config: { pixelId, apiKey }, missing: [] }
}

function readGa4Config(env: Env): { config: Ga4Config | null; missing: string[] } {
  const measurementId =
    readEnv(env, 'GA4_MEASUREMENT_ID') ||
    readEnv(env, 'GOOGLE_ANALYTICS_MEASUREMENT_ID') ||
    readEnv(env, 'NEXT_PUBLIC_GA4_MEASUREMENT_ID') ||
    readEnv(env, 'NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID')
  const apiSecret =
    readEnv(env, 'GA4_API_SECRET') ||
    readEnv(env, 'GOOGLE_ANALYTICS_API_SECRET') ||
    readEnv(env, 'GA4_MEASUREMENT_PROTOCOL_API_SECRET')
  const missing = ([
    ['GA4_MEASUREMENT_ID or NEXT_PUBLIC_GA4_MEASUREMENT_ID', measurementId],
    ['GA4_API_SECRET or GOOGLE_ANALYTICS_API_SECRET', apiSecret],
  ] as Array<[string, string | null]>)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length || !measurementId || !apiSecret) return { config: null, missing }
  return { config: { measurementId, apiSecret }, missing: [] }
}

function readEnabledDestinations(env: Env): { destinations: Set<DestinationResult['destination']>; missing: string[] } {
  const raw = readEnv(env, 'PPC_CONVERSION_EXPORT_DESTINATIONS')
  if (!raw) return { destinations: new Set(['google_ads', 'stape']), missing: [] }

  const values = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  const destinations = new Set<DestinationResult['destination']>()
  for (const value of values) {
    if (value === 'all') {
      destinations.add('google_ads')
      destinations.add('stape')
      destinations.add('openai_ads')
      destinations.add('ga4')
      continue
    }
    if (value === 'google_ads' || value === 'stape') destinations.add(value)
    if (value === 'openai_ads' || value === 'openai') destinations.add('openai_ads')
    if (value === 'ga4' || value === 'google_analytics') destinations.add('ga4')
  }

  return destinations.size > 0
    ? { destinations, missing: [] }
    : { destinations, missing: ['PPC_CONVERSION_EXPORT_DESTINATIONS'] }
}

function endpointHost(endpoint: string | null | undefined): string | null {
  if (!endpoint) return null
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint.replace(/^https?:\/\//, '').split('/')[0] || null
  }
}

function configMode(destinations: Set<DestinationResult['destination']>): PpcConversionExportConfigHealth['mode'] {
  const googleAds = destinations.has('google_ads')
  const stape = destinations.has('stape')
  const openaiAds = destinations.has('openai_ads')
  const ga4 = destinations.has('ga4')
  if (googleAds && stape && openaiAds && ga4) return 'all'
  if (googleAds && stape && openaiAds) return 'all'
  if (googleAds && stape) return 'google_ads_and_stape'
  if ([googleAds, stape, openaiAds, ga4].filter(Boolean).length > 1) return 'mixed'
  if (googleAds) return 'google_ads_only'
  if (stape) return 'stape_only'
  if (openaiAds) return 'openai_ads_only'
  if (ga4) return 'ga4_only'
  return 'not_configured'
}

export function getPpcConversionExportConfigHealth(env: Env = process.env): PpcConversionExportConfigHealth {
  const enabled = readEnabledDestinations(env)
  const googleEnabled = enabled.destinations.has('google_ads')
  const stapeEnabled = enabled.destinations.has('stape')
  const openaiEnabled = enabled.destinations.has('openai_ads')
  const ga4Enabled = enabled.destinations.has('ga4')
  const customerId = normalizeCustomerId(readEnv(env, 'GOOGLE_ADS_CUSTOMER_ID'))
  const actionMappings = customerId ? loadConversionActions(env, customerId) : {}
  const configuredActionMappings = GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES.filter((eventName) => Boolean(actionMappings[eventName]))
  const missingActionMappings = GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES.filter((eventName) => !actionMappings[eventName])
  const google = googleEnabled
    ? readGoogleAdsConfig(env)
    : { config: null, missing: [] }
  const stape = stapeEnabled
    ? readStapeConfig(env)
    : { config: null, missing: [] }
  const openai = openaiEnabled
    ? readOpenAIAdsConfig(env)
    : { config: null, missing: [] }
  const ga4 = ga4Enabled
    ? readGa4Config(env)
    : { config: null, missing: [] }
  const googleReady = Boolean(google.config && missingActionMappings.length === 0)
  const stapeReady = Boolean(stape.config)
  const openaiReady = Boolean(openai.config)
  const ga4Ready = Boolean(ga4.config)
  const warnings: string[] = []

  if (enabled.missing.length) {
    warnings.push('No valid export destination is enabled.')
  }
  if (stapeEnabled && stapeReady && !googleEnabled) {
    warnings.push('Approved conversions are configured for Stape/server GTM only; direct Google Ads API upload is not enabled.')
  }
  if (googleEnabled && google.missing.length > 0) {
    warnings.push(`Direct Google Ads API upload is missing ${google.missing.length} required credential value${google.missing.length === 1 ? '' : 's'}.`)
  }
  if (googleEnabled && missingActionMappings.length > 0) {
    warnings.push(`Direct Google Ads API upload is missing ${missingActionMappings.length} conversion action mapping${missingActionMappings.length === 1 ? '' : 's'}.`)
  }
  if (stapeEnabled && !stapeReady) {
    warnings.push('Stape/server GTM is enabled but its endpoint is not configured.')
  }
  if (openaiEnabled && !openaiReady) {
    warnings.push('OpenAI Ads export is enabled but its Pixel ID or Conversions API key is missing.')
  }
  if (ga4Enabled && !ga4Ready) {
    warnings.push('GA4 Measurement Protocol export is enabled but its Measurement ID or API secret is missing.')
  }

  return {
    configured: (googleEnabled && googleReady) || (stapeEnabled && stapeReady) || (openaiEnabled && openaiReady) || (ga4Enabled && ga4Ready),
    mode: configMode(enabled.destinations),
    enabledDestinations: Array.from(enabled.destinations),
    googleAds: {
      enabled: googleEnabled,
      ready: googleReady,
      customerId,
      apiVersion: google.config?.apiVersion ?? readEnv(env, 'GOOGLE_ADS_API_VERSION') ?? DEFAULT_GOOGLE_ADS_API_VERSION,
      missingConfig: google.missing,
      configuredActionMappings,
      missingActionMappings,
    },
    stape: {
      enabled: stapeEnabled,
      ready: stapeReady,
      endpointHost: endpointHost(stape.config?.endpoint ?? readEnv(env, 'PPC_STAPE_ENDPOINT_URL') ?? readEnv(env, 'STAPE_SGTM_DOMAIN')),
      previewHeaderConfigured: Boolean(stape.config?.previewHeader),
      missingConfig: stape.missing,
    },
    openaiAds: {
      enabled: openaiEnabled,
      ready: openaiReady,
      pixelIdConfigured: Boolean(readEnv(env, 'OPENAI_ADS_PIXEL_ID') || readEnv(env, 'NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID')),
      apiKeyConfigured: Boolean(readEnv(env, 'OPENAI_ADS_CONVERSIONS_API_KEY')),
      missingConfig: openai.missing,
    },
    ga4: {
      enabled: ga4Enabled,
      ready: ga4Ready,
      measurementIdConfigured: Boolean(
        readEnv(env, 'GA4_MEASUREMENT_ID') ||
        readEnv(env, 'GOOGLE_ANALYTICS_MEASUREMENT_ID') ||
        readEnv(env, 'NEXT_PUBLIC_GA4_MEASUREMENT_ID') ||
        readEnv(env, 'NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID'),
      ),
      apiSecretConfigured: Boolean(
        readEnv(env, 'GA4_API_SECRET') ||
        readEnv(env, 'GOOGLE_ANALYTICS_API_SECRET') ||
        readEnv(env, 'GA4_MEASUREMENT_PROTOCOL_API_SECRET'),
      ),
      missingConfig: ga4.missing,
    },
    warnings,
  }
}

function toGoogleAdsDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid conversion time: ${value}`)

  const iso = date.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`
}

function truncateOrderId(value: string): string {
  return value.length <= 100 ? value : value.slice(0, 100)
}

function normalizeE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('+')) {
    const digits = trimmed.replace(/\D/g, '')
    return digits.length >= 8 ? `+${digits}` : null
  }

  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

function eventPayload(row: PpcConversionOutboxExportRow): Record<string, unknown> {
  return row.payload ?? {}
}

function approvalRequired(row: PpcConversionOutboxExportRow): boolean {
  return isGoogleAdsApprovalRequiredPpcEvent(row.event_name, row.payload)
}

function googleAdsConversionValue(row: PpcConversionOutboxExportRow): number | null {
  if (isGoogleAdsFactualPpcEvent(row.event_name) && !approvalRequired(row)) return 1
  return resolveGoogleAdsQualityScore(row.conversion_value, row.payload)
}

function missingQualityScoreReason(row: PpcConversionOutboxExportRow): string {
  return `${row.event_name} must be approved with a Google Ads quality score of 1, 2, or 3 before export`
}

function inferCallStartDate(row: PpcConversionOutboxExportRow): Date {
  const payload = eventPayload(row)
  const explicit =
    payload.call_start_date_time ||
    payload.callStartDateTime ||
    payload.call_started_at ||
    payload.callStartedAt

  if (typeof explicit === 'string' && explicit.trim()) return new Date(explicit)

  const duration = Number(payload.duration ?? payload.dialCallDuration ?? payload.callDuration ?? 0)
  const eventDate = new Date(row.event_time)
  if (!Number.isFinite(duration) || duration <= 0 || Number.isNaN(eventDate.getTime())) return eventDate
  return new Date(eventDate.getTime() - duration * 1000)
}

export function isPpcConversionExportReady(row: PpcConversionOutboxExportRow, now = new Date()): boolean {
  if (row.event_category !== 'call') return true

  const callStartDate = inferCallStartDate(row)
  if (Number.isNaN(callStartDate.getTime())) return true

  return now.getTime() - callStartDate.getTime() >= GOOGLE_ADS_CALL_CONVERSION_MIN_AGE_MS
}

function ppcConversionProcessingStaleCutoff(now: Date): string {
  return new Date(now.getTime() - PPC_CONVERSION_PROCESSING_LOCK_TTL_MS).toISOString()
}

export function isPpcConversionOutboxClaimable(row: PpcConversionOutboxExportRow, now = new Date()): boolean {
  if (row.status === 'pending' || row.status === 'failed') return true
  if (row.status !== 'processing') return false
  if (!row.locked_at) return true

  const lockedAt = Date.parse(row.locked_at)
  if (!Number.isFinite(lockedAt)) return true

  return lockedAt <= now.getTime() - PPC_CONVERSION_PROCESSING_LOCK_TTL_MS
}

export function ppcConversionClaimableStatusFilter(now = new Date()): string {
  const staleCutoff = ppcConversionProcessingStaleCutoff(now)
  return [
    'status.in.(pending,failed)',
    `and(status.eq.processing,locked_at.lt.${staleCutoff})`,
    'and(status.eq.processing,locked_at.is.null)',
  ].join(',')
}

export function buildGoogleAdsUploadPlan(
  row: PpcConversionOutboxExportRow,
  config: GoogleAdsConfig,
): GoogleAdsUploadPlan {
  if (!isGoogleAdsExportablePpcEvent(row.event_name)) {
    return {
      kind: 'skip',
      reason: nonExportablePpcEventReason(row.event_name),
      hardFailure: false,
    }
  }

  const conversionValue = googleAdsConversionValue(row)
  if (!conversionValue) {
    return {
      kind: 'skip',
      reason: missingQualityScoreReason(row),
      hardFailure: true,
    }
  }

  const conversionAction = config.conversionActions[row.event_name]
  if (!conversionAction) {
    return {
      kind: 'skip',
      reason: `Missing conversion action mapping for ${row.event_name}`,
      hardFailure: row.optimization_role === 'primary',
    }
  }

  const base = {
    conversionAction,
    conversionDateTime: toGoogleAdsDateTime(row.event_time),
    conversionValue,
    currencyCode: row.currency || 'USD',
  }

  if (row.event_category === 'call') {
    const payload = eventPayload(row)
    const callerId = normalizeE164(payload.from ?? payload.callerId ?? payload.caller_id)
    if (callerId) {
      const callStartDate = inferCallStartDate(row)
      return {
        kind: 'call',
        conversion: cleanJsonRecord({
          ...base,
          callerId,
          callStartDateTime: toGoogleAdsDateTime(callStartDate),
          consent: config.adUserDataConsent
            ? { adUserData: config.adUserDataConsent }
            : undefined,
        }),
      }
    }
  }

  // Prefer identifiers stored on the event payload; fall back to attribution.
  const payloadIds = readUserIdentifiers(eventPayload(row))
  const userIdentifiers =
    payloadIds.length > 0 ? payloadIds : readUserIdentifiers(row.attribution)

  const hasClickId = Boolean(row.click_id && row.click_id_type)

  // Enhanced Conversions for Leads: a click id is no longer required as long as
  // we have hashed first-party identifiers. Only skip when BOTH are missing.
  if (!hasClickId && userIdentifiers.length === 0) {
    return {
      kind: 'skip',
      reason: `No click id or user identifiers for ${row.event_name}`,
      hardFailure: row.optimization_role === 'primary',
    }
  }

  return {
    kind: 'click',
    conversion: cleanJsonRecord({
      ...base,
      ...(hasClickId ? { [row.click_id_type as PpcClickIdType]: row.click_id } : {}),
      orderId: truncateOrderId(row.dedupe_key),
      userIdentifiers: userIdentifiers.length ? userIdentifiers : undefined,
      consent: config.adUserDataConsent
        ? { adUserData: config.adUserDataConsent }
        : undefined,
    }),
  }
}

function buildStapeEventData(row: PpcConversionOutboxExportRow): Record<string, unknown> {
  const attribution = row.attribution ?? {}
  const payload = row.payload ?? {}
  const conversionValue = googleAdsConversionValue(row)
  const pageLocation =
    attribution.landingUrl ||
    attribution.page_location ||
    payload.page_location ||
    'https://savingkc.com/ppc'
  const pagePath = text(payload.page_path) ||
    text(attribution.page_path) ||
    ppcCampaignForPageLocation(pageLocation)?.pagePath ||
    '/ppc'
  const campaign = ppcCampaignNameForContext({
    campaign: payload.campaign,
    attribution,
    pagePath,
    pageLocation,
  })

  return cleanJsonRecord({
    event_id: row.id,
    event_name: row.event_name,
    event_time: row.event_time,
    event_category: row.event_category,
    optimization_role: row.optimization_role,
    value: conversionValue,
    currency: row.currency || 'USD',
    page_location: pageLocation,
    page_hostname: 'savingkc.com',
    page_path: pagePath,
    traffic_source: 'google_ads',
    campaign,
    gclid: row.click_id_type === 'gclid' ? row.click_id : undefined,
    gbraid: row.click_id_type === 'gbraid' ? row.click_id : undefined,
    wbraid: row.click_id_type === 'wbraid' ? row.click_id : undefined,
    lead_id: row.lead_id,
    manifest_id: row.manifest_id,
    activity_id: row.activity_id,
    attribution,
    ppc_payload: payload,
  })
}

function isOpenAIAdsExportablePpcEvent(eventName: string | null | undefined): boolean {
  return Boolean(eventName && OPENAI_ADS_EXPORTABLE_PPC_EVENTS.has(eventName))
}

function isGa4ExportablePpcEvent(eventName: string | null | undefined): boolean {
  return Boolean(eventName && GA4_EXPORTABLE_PPC_EVENTS.has(eventName))
}

function sourceUrlForRow(row: PpcConversionOutboxExportRow): string {
  const attribution = row.attribution ?? {}
  const payload = row.payload ?? {}
  return (
    text(payload.page_location) ||
    text(attribution.page_location) ||
    text(attribution.landingUrl) ||
    'https://savingkc.com/ppc'
  )
}

function ga4EventName(row: PpcConversionOutboxExportRow): string | null {
  if (row.event_name === 'lead_submitted') return 'generate_lead'
  if (row.event_name === 'qualified_lead') return 'qualified_lead'
  if (row.event_name === 'appointment_booked') return 'appointment_booked'
  if (
    row.event_name === 'call_connected_60s' ||
    row.event_name === 'call_connected_2m' ||
    row.event_name === 'call_connected_5m'
  ) {
    return row.event_name
  }
  return null
}

function ga4FallbackClientId(row: PpcConversionOutboxExportRow): string {
  const seed = [row.id, row.dedupe_key, row.lead_id, row.manifest_id].filter(Boolean).join(':') || row.event_time
  const hash = createHash('sha256').update(seed).digest('hex')
  return `${Number.parseInt(hash.slice(0, 8), 16)}.${Number.parseInt(hash.slice(8, 16), 16)}`
}

function ga4ClientIdForRow(row: PpcConversionOutboxExportRow): string {
  const attribution = row.attribution ?? {}
  const payload = row.payload ?? {}
  return (
    text(payload.ga_client_id) ||
    text(payload.ga4_client_id) ||
    text(payload.client_id) ||
    text(payload.clientId) ||
    text(attribution.ga_client_id) ||
    text(attribution.ga4_client_id) ||
    text(attribution.client_id) ||
    text(attribution.clientId) ||
    ga4FallbackClientId(row)
  )
}

function buildGa4UploadPlan(row: PpcConversionOutboxExportRow): Ga4UploadPlan {
  if (!isGa4ExportablePpcEvent(row.event_name)) {
    return {
      kind: 'skip',
      reason: `${row.event_name || 'conversion'} is not eligible for GA4 export`,
      hardFailure: false,
    }
  }

  const eventDate = new Date(row.event_time)
  if (Number.isNaN(eventDate.getTime())) {
    return {
      kind: 'skip',
      reason: `Invalid GA4 event time for ${row.event_name}`,
      hardFailure: true,
    }
  }

  const eventName = ga4EventName(row)
  if (!eventName) {
    return {
      kind: 'skip',
      reason: `${row.event_name} has no GA4 event mapping`,
      hardFailure: false,
    }
  }

  const attribution = row.attribution ?? {}
  const payload = row.payload ?? {}
  const pageLocation = sourceUrlForRow(row)
  const pagePath =
    text(payload.page_path) ||
    text(attribution.page_path) ||
    ppcCampaignForPageLocation(pageLocation)?.pagePath ||
    undefined
  const campaign = ppcCampaignNameForContext({
    campaign: payload.campaign,
    attribution,
    pagePath,
    pageLocation,
  })

  return {
    kind: 'event',
    eventName,
    body: cleanJsonRecord({
      client_id: ga4ClientIdForRow(row),
      timestamp_micros: eventDate.getTime() * 1000,
      non_personalized_ads: false,
      events: [
        {
          name: eventName,
          params: cleanJsonRecord({
            event_id: text(payload.openai_ads_event_id) || row.dedupe_key || row.id,
            dedupe_key: row.dedupe_key,
            engagement_time_msec: 1,
            value: googleAdsConversionValue(row) ?? undefined,
            currency: row.currency || 'USD',
            event_category: row.event_category,
            optimization_role: row.optimization_role,
            lead_id: row.lead_id,
            manifest_id: row.manifest_id,
            activity_id: row.activity_id,
            campaign,
            page_location: pageLocation,
            page_path: pagePath,
            traffic_source: text(payload.traffic_source) || text(attribution.traffic_source) || 'paid',
            click_id_type: row.click_id_type,
            gclid: row.click_id_type === 'gclid' ? row.click_id : undefined,
            gbraid: row.click_id_type === 'gbraid' ? row.click_id : undefined,
            wbraid: row.click_id_type === 'wbraid' ? row.click_id : undefined,
          }),
        },
      ],
    }),
  }
}

function openAIAdsActionSource(row: PpcConversionOutboxExportRow): string {
  if (row.event_category === 'call') return 'phone_call'
  if (row.event_name === 'qualified_lead') return 'offline'
  return 'web'
}

function openAIAdsEventType(row: PpcConversionOutboxExportRow): {
  type: string
  customEventName?: string
  dataType: 'customer_action' | 'custom'
} | null {
  if (row.event_name === 'lead_submitted') {
    return { type: 'lead_created', dataType: 'customer_action' }
  }
  if (row.event_name === 'appointment_booked') {
    return { type: 'appointment_scheduled', dataType: 'customer_action' }
  }
  if (
    row.event_name === 'qualified_lead' ||
    row.event_name === 'call_connected_60s' ||
    row.event_name === 'call_connected_2m' ||
    row.event_name === 'call_connected_5m'
  ) {
    return { type: 'custom', customEventName: row.event_name, dataType: 'custom' }
  }
  return null
}

function buildOpenAIAdsUploadPlan(row: PpcConversionOutboxExportRow, now: Date): OpenAIAdsUploadPlan {
  if (!isOpenAIAdsExportablePpcEvent(row.event_name)) {
    return {
      kind: 'skip',
      reason: `${row.event_name || 'conversion'} is not eligible for OpenAI Ads export`,
      hardFailure: false,
    }
  }

  const eventDate = new Date(row.event_time)
  if (Number.isNaN(eventDate.getTime())) {
    return {
      kind: 'skip',
      reason: `Invalid OpenAI Ads event time for ${row.event_name}`,
      hardFailure: true,
    }
  }

  const ageMs = now.getTime() - eventDate.getTime()
  if (ageMs > OPENAI_ADS_MAX_EVENT_AGE_MS) {
    return {
      kind: 'skip',
      reason: 'OpenAI Ads CAPI accepts events from the last 7 days only',
      hardFailure: false,
    }
  }
  if (ageMs < -OPENAI_ADS_MAX_FUTURE_SKEW_MS) {
    return {
      kind: 'skip',
      reason: 'OpenAI Ads CAPI rejects events more than 10 minutes in the future',
      hardFailure: true,
    }
  }

  const mapped = openAIAdsEventType(row)
  if (!mapped) {
    return {
      kind: 'skip',
      reason: `${row.event_name} has no OpenAI Ads event mapping`,
      hardFailure: false,
    }
  }

  const attribution = row.attribution ?? {}
  const payload = row.payload ?? {}
  const actionSource = openAIAdsActionSource(row)
  const sourceUrl = sourceUrlForRow(row)
  const eventId = text(payload.openai_ads_event_id) || row.dedupe_key || row.id

  return {
    kind: 'event',
    event: cleanJsonRecord({
      id: eventId,
      type: mapped.type,
      custom_event_name: mapped.customEventName,
      timestamp_ms: eventDate.getTime(),
      oppref: text(attribution.oppref) || text(payload.oppref),
      source_url: sourceUrl,
      action_source: actionSource,
      data: {
        type: mapped.dataType,
      },
    }),
  }
}

async function resolveGoogleAdsRefreshToken(config: GoogleAdsConfig, client: SupabaseClient): Promise<string> {
  if (config.refreshToken) return config.refreshToken

  if (!config.refreshTokenUserEmail) {
    throw new Error('Missing Google Ads refresh token configuration')
  }

  const { data, error } = await client
    .from('user_oauth_tokens')
    .select('refresh_token, scope')
    .eq('provider', 'google_ads')
    .eq('user_email', config.refreshTokenUserEmail)
    .maybeSingle()

  if (error) throw new Error(`Google Ads OAuth lookup failed: ${error.message}`)

  const refreshToken = typeof data?.refresh_token === 'string' ? data.refresh_token.trim() : ''
  if (!refreshToken) {
    throw new Error(`No saved Google Ads OAuth refresh token for ${config.refreshTokenUserEmail}`)
  }

  const scope = typeof data?.scope === 'string' ? data.scope : ''
  if (!scope.split(/\s+/).includes('https://www.googleapis.com/auth/adwords')) {
    throw new Error(`Saved Google Ads OAuth token for ${config.refreshTokenUserEmail} is missing the adwords scope`)
  }

  return refreshToken
}

async function fetchGoogleAdsAccessToken(
  config: GoogleAdsConfig,
  refreshToken: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const response = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  const body = await response.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string }
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `Google OAuth failed (${response.status})`)
  }

  return body.access_token
}

export async function getGoogleAdsAccessToken(config: GoogleAdsConfig, fetchFn: typeof fetch): Promise<string> {
  const refreshToken = config.refreshToken ?? await resolveGoogleAdsRefreshToken(config, supabaseAdmin())
  return fetchGoogleAdsAccessToken(config, refreshToken, fetchFn)
}

async function uploadGoogleAdsConversion(
  row: PpcConversionOutboxExportRow,
  plan: Exclude<GoogleAdsUploadPlan, { kind: 'skip' }>,
  config: GoogleAdsConfig,
  accessToken: string,
  fetchFn: typeof fetch,
  validateOnly: boolean,
): Promise<DestinationResult> {
  const method = plan.kind === 'call' ? 'uploadCallConversions' : 'uploadClickConversions'
  const response = await fetchFn(
    `https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}:${method}`,
    {
      method: 'POST',
      headers: cleanJsonRecord({
        'Content-Type': 'application/json',
        'developer-token': config.developerToken,
        'Authorization': `Bearer ${accessToken}`,
        'login-customer-id': config.loginCustomerId ?? undefined,
      }) as HeadersInit,
      body: JSON.stringify({
        conversions: [plan.conversion],
        partialFailure: true,
        validateOnly: validateOnly || undefined,
      }),
    },
  )

  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    return {
      destination: 'google_ads',
      status: 'failed',
      detail: summarizeRemoteError(body, `Google Ads ${method} failed (${response.status})`),
    }
  }

  const partialFailure = body.partialFailureError as { message?: string } | undefined
  if (partialFailure?.message) {
    return {
      destination: 'google_ads',
      status: 'failed',
      detail: partialFailure.message,
    }
  }

  return {
    destination: 'google_ads',
    status: validateOnly ? 'would_send' : 'sent',
    detail: `${validateOnly ? 'validateOnly:' : ''}${method}:${row.event_name}`,
  }
}

function isUnmatchedGoogleAdsCallUpload(row: PpcConversionOutboxExportRow, detail: string | undefined): boolean {
  if (row.event_category !== 'call') return false

  const normalized = (detail ?? '').toLowerCase()
  if (!normalized) return false

  return (
    normalized.includes('caller_id') &&
    (
      normalized.includes("can't be found") ||
      normalized.includes('cannot be found') ||
      normalized.includes("couldn't be found") ||
      normalized.includes('could not be found')
    )
  )
}

function googleAdsUnmatchedCallSkipReason(): string {
  return 'Google Ads call upload skipped: caller_id was not matchable to a Google Ads call record. Keep CRM/Stape/OpenAI call attribution; use Google forwarding/DNI for Google call-only optimization.'
}

export function normalizeGoogleAdsDestinationResult(
  row: PpcConversionOutboxExportRow,
  result: DestinationResult,
): DestinationResult {
  if (result.status !== 'failed' || !isUnmatchedGoogleAdsCallUpload(row, result.detail)) return result

  return {
    ...result,
    status: 'skipped',
    detail: googleAdsUnmatchedCallSkipReason(),
  }
}

async function sendStapeEvent(
  row: PpcConversionOutboxExportRow,
  config: StapeConfig,
  fetchFn: typeof fetch,
): Promise<DestinationResult> {
  const url = new URL(config.endpoint)
  url.searchParams.set('v', '2')
  url.searchParams.set('event_name', row.event_name)

  const response = await fetchFn(url.toString(), {
    method: 'POST',
    headers: cleanJsonRecord({
      'Content-Type': 'application/json',
      'Origin': config.origin,
      'X-Gtm-Server-Preview': config.previewHeader ?? undefined,
    }) as HeadersInit,
    body: JSON.stringify({
      ...buildStapeEventData(row),
      event_name: row.event_name,
      v: 2,
    }),
  })

  const body = await response.text().catch(() => '')
  if (!response.ok) {
    return {
      destination: 'stape',
      status: 'failed',
      detail: body || `Stape failed (${response.status})`,
    }
  }

  return {
    destination: 'stape',
    status: 'sent',
    detail: body.slice(0, 200) || 'accepted',
  }
}

async function sendGa4Event(
  row: PpcConversionOutboxExportRow,
  config: Ga4Config,
  fetchFn: typeof fetch,
  validateOnly: boolean,
): Promise<DestinationResult> {
  const plan = buildGa4UploadPlan(row)
  if (plan.kind === 'skip') {
    return {
      destination: 'ga4',
      status: plan.hardFailure ? 'failed' : 'skipped',
      detail: plan.reason,
    }
  }

  const url = new URL(validateOnly ? GA4_MEASUREMENT_PROTOCOL_DEBUG_ENDPOINT : GA4_MEASUREMENT_PROTOCOL_ENDPOINT)
  url.searchParams.set('measurement_id', config.measurementId)
  url.searchParams.set('api_secret', config.apiSecret)

  const response = await fetchFn(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan.body),
  })

  const bodyText = await response.text().catch(() => '')
  let body: Record<string, unknown> = {}
  try {
    body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {}
  } catch {
    body = {}
  }

  if (!response.ok) {
    return {
      destination: 'ga4',
      status: 'failed',
      detail: summarizeRemoteError(body, bodyText || `GA4 Measurement Protocol failed (${response.status})`),
    }
  }

  if (validateOnly) {
    const validationMessages = Array.isArray(body.validationMessages) ? body.validationMessages : []
    const errorMessage = validationMessages
      .map((message) => {
        if (!message || typeof message !== 'object') return String(message)
        const typed = message as { validationCode?: unknown; description?: unknown; fieldPath?: unknown }
        const description = typeof typed.description === 'string' ? typed.description : ''
        const validationCode = typeof typed.validationCode === 'string' ? typed.validationCode : ''
        const fieldPath = typeof typed.fieldPath === 'string' ? typed.fieldPath : ''
        return [fieldPath, validationCode, description].filter(Boolean).join(': ')
      })
      .find(Boolean)

    if (errorMessage) {
      return {
        destination: 'ga4',
        status: 'failed',
        detail: String(errorMessage),
      }
    }
  }

  return {
    destination: 'ga4',
    status: validateOnly ? 'would_send' : 'sent',
    detail: `${validateOnly ? 'validateOnly:' : ''}${plan.eventName}:${row.event_name}`,
  }
}

async function sendOpenAIAdsEvent(
  row: PpcConversionOutboxExportRow,
  config: OpenAIAdsConfig,
  fetchFn: typeof fetch,
  validateOnly: boolean,
  now: Date,
): Promise<DestinationResult> {
  const plan = buildOpenAIAdsUploadPlan(row, now)
  if (plan.kind === 'skip') {
    return {
      destination: 'openai_ads',
      status: plan.hardFailure ? 'failed' : 'skipped',
      detail: plan.reason,
    }
  }

  const url = new URL(OPENAI_ADS_CONVERSIONS_ENDPOINT)
  url.searchParams.set('pid', config.pixelId)

  const response = await fetchFn(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      validate_only: validateOnly || undefined,
      events: [plan.event],
    }),
  })

  const bodyText = await response.text().catch(() => '')
  let body: Record<string, unknown> = {}
  try {
    body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {}
  } catch {
    body = {}
  }

  if (!response.ok) {
    return {
      destination: 'openai_ads',
      status: 'failed',
      detail: summarizeRemoteError(body, bodyText || `OpenAI Ads CAPI failed (${response.status})`),
    }
  }

  return {
    destination: 'openai_ads',
    status: validateOnly ? 'would_send' : 'sent',
    detail: `${validateOnly ? 'validateOnly:' : ''}${plan.event.type}:${row.event_name}`,
  }
}

function summarizeRemoteError(body: Record<string, unknown>, fallback: string): string {
  const error = body.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return fallback
}

function plannedDestinations(
  row: PpcConversionOutboxExportRow,
  googleConfig: GoogleAdsConfig | null,
  stapeConfig: StapeConfig | null,
  openaiConfig: OpenAIAdsConfig | null,
  ga4Config: Ga4Config | null,
  now: Date,
): DestinationResult[] {
  const googleEligible = isGoogleAdsExportablePpcEvent(row.event_name)
  const openaiEligible = isOpenAIAdsExportablePpcEvent(row.event_name)
  const ga4Eligible = isGa4ExportablePpcEvent(row.event_name)

  if (!googleEligible && !openaiEligible && !ga4Eligible) {
    const detail = nonExportablePpcEventReason(row.event_name)
    return [
      ...(stapeConfig ? [{ destination: 'stape' as const, status: 'skipped' as const, detail }] : []),
      ...(googleConfig ? [{ destination: 'google_ads' as const, status: 'skipped' as const, detail }] : []),
      ...(openaiConfig ? [{ destination: 'openai_ads' as const, status: 'skipped' as const, detail }] : []),
      ...(ga4Config ? [{ destination: 'ga4' as const, status: 'skipped' as const, detail }] : []),
    ]
  }

  const conversionValue = googleAdsConversionValue(row)
  if (googleEligible && !conversionValue) {
    const detail = missingQualityScoreReason(row)
    return [
      ...(stapeConfig ? [{ destination: 'stape' as const, status: 'skipped' as const, detail }] : []),
      ...(googleConfig ? [{ destination: 'google_ads' as const, status: 'failed' as const, detail }] : []),
      ...(openaiConfig ? [{ destination: 'openai_ads' as const, status: 'skipped' as const, detail }] : []),
      ...(ga4Config ? [{ destination: 'ga4' as const, status: 'skipped' as const, detail }] : []),
    ]
  }

  const destinations: DestinationResult[] = []
  if (stapeConfig) {
    destinations.push(
      googleEligible
        ? { destination: 'stape', status: 'would_send', detail: stapeConfig.endpoint }
        : { destination: 'stape', status: 'skipped', detail: nonExportablePpcEventReason(row.event_name) },
    )
  }

  if (googleConfig) {
    if (googleEligible) {
      const plan = buildGoogleAdsUploadPlan(row, googleConfig)
      destinations.push(
        plan.kind === 'skip'
          ? { destination: 'google_ads', status: 'skipped', detail: plan.reason }
          : { destination: 'google_ads', status: 'would_send', detail: plan.kind },
      )
    } else {
      destinations.push({ destination: 'google_ads', status: 'skipped', detail: nonExportablePpcEventReason(row.event_name) })
    }
  }

  if (openaiConfig) {
    const plan = buildOpenAIAdsUploadPlan(row, now)
    destinations.push(
      plan.kind === 'skip'
        ? { destination: 'openai_ads', status: plan.hardFailure ? 'failed' : 'skipped', detail: plan.reason }
        : { destination: 'openai_ads', status: 'would_send', detail: plan.event.type as string },
    )
  }

  if (ga4Config) {
    const plan = buildGa4UploadPlan(row)
    destinations.push(
      plan.kind === 'skip'
        ? { destination: 'ga4', status: plan.hardFailure ? 'failed' : 'skipped', detail: plan.reason }
        : { destination: 'ga4', status: 'would_send', detail: plan.eventName },
    )
  }

  return destinations
}

function rowSummary(row: PpcConversionOutboxExportRow, destinations: DestinationResult[], now: Date) {
  return cleanJsonRecord({
    exported_at: now.toISOString(),
    destinations,
  })
}

export async function runPpcConversionExport(
  options: PpcConversionExportOptions = {},
  deps: PpcConversionExportDeps = {},
): Promise<PpcConversionExportResult> {
  const env = options.env ?? process.env
  const now = options.now ?? new Date()
  const dryRun = options.dryRun === true
  const validateOnly = options.validateOnly === true
  const readOnly = dryRun || validateOnly
  const maxAttempts = parsePositiveInt(options.maxAttempts, DEFAULT_MAX_ATTEMPTS)
  const batchSize = clampBatchSize(options.batchSize)
  const fetchFn = deps.fetch ?? fetch

  const enabled = readEnabledDestinations(env)
  const google = enabled.destinations.has('google_ads')
    ? readGoogleAdsConfig(env)
    : { config: null, missing: [] }
  const stape = enabled.destinations.has('stape')
    ? readStapeConfig(env)
    : { config: null, missing: [] }
  const openai = enabled.destinations.has('openai_ads')
    ? readOpenAIAdsConfig(env)
    : { config: null, missing: [] }
  const ga4 = enabled.destinations.has('ga4')
    ? readGa4Config(env)
    : { config: null, missing: [] }
  const missingConfig = [...enabled.missing, ...google.missing, ...stape.missing, ...openai.missing, ...ga4.missing]

  if (!google.config && !stape.config && !openai.config && !ga4.config) {
    return emptyExportResult({ dryRun, configured: false, missingConfig })
  }

  const store = deps.store ?? new SupabaseOutboxStore(supabaseAdmin(), maxAttempts)
  const repairedKnownSkips = readOnly ? 0 : await (store.repairKnownSkippedRows?.(now) ?? Promise.resolve(0))
  const rows = readOnly
    ? await store.listRows(batchSize, now)
    : await store.claimRows(batchSize, now)

  const results: RowExportResult[] = []
  let tokenPromise: Promise<string> | null = null

  for (const row of rows) {
    if (dryRun) {
      const destinations = plannedDestinations(row, google.config, stape.config, openai.config, ga4.config, now)
      results.push({ id: row.id, eventName: row.event_name, status: 'pending', destinations })
      continue
    }

    if (!row.approved_for_google_ads && approvalRequired(row)) {
      const destinations: DestinationResult[] = [
        { destination: 'google_ads', status: 'skipped', detail: 'Awaiting approval for Google Ads export' },
      ]
      if (stape.config) {
        destinations.unshift({ destination: 'stape', status: 'skipped', detail: 'Awaiting approval for Google Ads export' })
      }
      if (openai.config) {
        destinations.push({ destination: 'openai_ads', status: 'skipped', detail: 'Awaiting approval for ads export' })
      }
      if (ga4.config) {
        destinations.push({ destination: 'ga4', status: 'skipped', detail: 'Awaiting approval for ads export' })
      }
      if (validateOnly) {
        results.push({ id: row.id, eventName: row.event_name, status: 'pending', destinations })
        continue
      }
      const summary = rowSummary(row, destinations, now)
      await store.markSkipped(row, 'Awaiting approval for Google Ads export', summary, now)
      results.push({ id: row.id, eventName: row.event_name, status: 'skipped', destinations })
      continue
    }

    const googleEligible = isGoogleAdsExportablePpcEvent(row.event_name)
    const openaiEligible = isOpenAIAdsExportablePpcEvent(row.event_name)
    const ga4Eligible = isGa4ExportablePpcEvent(row.event_name)

    if (!googleEligible && !openaiEligible && !ga4Eligible) {
      const detail = nonExportablePpcEventReason(row.event_name)
      const destinations: DestinationResult[] = [
        ...(stape.config ? [{ destination: 'stape' as const, status: 'skipped' as const, detail }] : []),
        ...(google.config ? [{ destination: 'google_ads' as const, status: 'skipped' as const, detail }] : []),
        ...(openai.config ? [{ destination: 'openai_ads' as const, status: 'skipped' as const, detail }] : []),
        ...(ga4.config ? [{ destination: 'ga4' as const, status: 'skipped' as const, detail }] : []),
      ]
      if (validateOnly) {
        results.push({ id: row.id, eventName: row.event_name, status: 'skipped', destinations })
        continue
      }
      await store.markSkipped(row, detail, rowSummary(row, destinations, now), now)
      results.push({ id: row.id, eventName: row.event_name, status: 'skipped', destinations })
      continue
    }

    const conversionValue = googleAdsConversionValue(row)
    if (googleEligible && !conversionValue) {
      const detail = missingQualityScoreReason(row)
      const destinations: DestinationResult[] = [
        ...(stape.config ? [{ destination: 'stape' as const, status: 'skipped' as const, detail }] : []),
        ...(google.config ? [{ destination: 'google_ads' as const, status: 'failed' as const, detail }] : []),
        ...(openai.config ? [{ destination: 'openai_ads' as const, status: 'skipped' as const, detail }] : []),
        ...(ga4.config ? [{ destination: 'ga4' as const, status: 'skipped' as const, detail }] : []),
      ]
      if (validateOnly) {
        results.push({ id: row.id, eventName: row.event_name, status: 'failed', destinations })
        continue
      }
      await store.markFailed(row, detail, rowSummary(row, destinations, now), now)
      results.push({ id: row.id, eventName: row.event_name, status: 'failed', destinations })
      continue
    }

    const destinations: DestinationResult[] = []

    if (stape.config) {
      destinations.push(
        googleEligible
          ? validateOnly
            ? { destination: 'stape', status: 'would_send', detail: 'Validate-only run; Stape request not sent' }
            : await sendStapeEvent(row, stape.config, fetchFn)
          : { destination: 'stape', status: 'skipped', detail: nonExportablePpcEventReason(row.event_name) },
      )
    }

    if (google.config) {
      if (!googleEligible) {
        destinations.push({ destination: 'google_ads', status: 'skipped', detail: nonExportablePpcEventReason(row.event_name) })
      } else {
        const plan = buildGoogleAdsUploadPlan(row, google.config)
        if (plan.kind === 'skip') {
          destinations.push({ destination: 'google_ads', status: plan.hardFailure ? 'failed' : 'skipped', detail: plan.reason })
        } else {
          tokenPromise = tokenPromise ?? getGoogleAdsAccessToken(google.config, fetchFn)
          const accessToken = await tokenPromise
          destinations.push(
            normalizeGoogleAdsDestinationResult(
              row,
              await uploadGoogleAdsConversion(
                row,
                plan,
                google.config,
                accessToken,
                fetchFn,
                validateOnly,
              ),
            ),
          )
        }
      }
    }

    if (openai.config) {
      destinations.push(
        openaiEligible
          ? await sendOpenAIAdsEvent(row, openai.config, fetchFn, validateOnly, now)
          : { destination: 'openai_ads', status: 'skipped', detail: `${row.event_name} is not eligible for OpenAI Ads export` },
      )
    }

    if (ga4.config) {
      destinations.push(
        ga4Eligible
          ? await sendGa4Event(row, ga4.config, fetchFn, validateOnly)
          : { destination: 'ga4', status: 'skipped', detail: `${row.event_name} is not eligible for GA4 export` },
      )
    }

    const failed = destinations.filter((destination) => destination.status === 'failed')
    const sent = destinations.filter((destination) => destination.status === 'sent')
    let summary = rowSummary(row, destinations, now)

    if (validateOnly) {
      results.push({ id: row.id, eventName: row.event_name, status: failed.length > 0 ? 'failed' : 'pending', destinations })
      continue
    }

    if (failed.length > 0) {
      const reason = failed.map((failure) => `${failure.destination}: ${failure.detail || 'failed'}`).join('; ')
      await store.markFailed(row, reason, summary, now)
      results.push({ id: row.id, eventName: row.event_name, status: 'failed', destinations })
      continue
    }

    if (sent.length > 0) {
      const qualifiedLeadSmsAlert = await maybeNotifyQualifiedLeadExport(row, destinations, now, deps)
      if (qualifiedLeadSmsAlert) {
        summary = cleanJsonRecord({
          ...summary,
          qualified_lead_sms_alert: qualifiedLeadSmsAlert,
        })
      }
      await store.markSent(row, summary, now)
      results.push({ id: row.id, eventName: row.event_name, status: 'sent', destinations })
      continue
    }

    const reason = destinations.map((destination) => destination.detail).filter(Boolean).join('; ') || 'No configured export destination'
    await store.markSkipped(row, reason, summary, now)
    results.push({ id: row.id, eventName: row.event_name, status: 'skipped', destinations })
  }

  return {
    ok: true,
    dryRun,
    configured: true,
    scanned: rows.length,
    claimed: readOnly ? 0 : rows.length,
    repairedKnownSkips,
    sent: results.filter((result) => result.status === 'sent').length,
    skipped: repairedKnownSkips + results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
    pending: results.filter((result) => result.status === 'pending').length,
    missingConfig,
    results,
  }
}

function emptyExportResult(input: { dryRun: boolean; configured: boolean; missingConfig: string[] }): PpcConversionExportResult {
  return {
    ok: input.configured,
    dryRun: input.dryRun,
    configured: input.configured,
    scanned: 0,
    claimed: 0,
    repairedKnownSkips: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    pending: 0,
    missingConfig: input.missingConfig,
    results: [],
  }
}

const PPC_EVENT_NAMES: PpcConversionEventName[] = GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES
