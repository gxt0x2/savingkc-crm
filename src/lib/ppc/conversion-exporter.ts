import type { SupabaseClient } from '@supabase/supabase-js'
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
  GOOGLE_ADS_FACTUAL_PPC_EVENT_NAMES,
  GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES,
  isGoogleAdsApprovalRequiredPpcEvent,
  isGoogleAdsExportablePpcEvent,
  isGoogleAdsFactualPpcEvent,
  nonExportablePpcEventReason,
} from '@/lib/ppc/exportable-events'
import { ppcCampaignNameForContext, ppcCampaignForPageLocation } from '@/lib/ppc/campaigns'

const DEFAULT_BATCH_SIZE = 25
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_GOOGLE_ADS_API_VERSION = 'v24'
const DEFAULT_STAPE_REQUEST_PATH = '/data'

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
  destination: 'google_ads' | 'stape'
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
  sent: number
  skipped: number
  failed: number
  pending: number
  missingConfig: string[]
  results: RowExportResult[]
}

export type PpcConversionExportConfigHealth = {
  configured: boolean
  mode: 'google_ads_and_stape' | 'google_ads_only' | 'stape_only' | 'not_configured'
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
  warnings: string[]
}

type OutboxStore = {
  listRows(limit: number, now: Date): Promise<PpcConversionOutboxExportRow[]>
  claimRows(limit: number, now: Date): Promise<PpcConversionOutboxExportRow[]>
  markSent(row: PpcConversionOutboxExportRow, summary: Record<string, unknown>, now: Date): Promise<void>
  markSkipped(row: PpcConversionOutboxExportRow, reason: string, summary: Record<string, unknown>, now: Date): Promise<void>
  markFailed(row: PpcConversionOutboxExportRow, reason: string, summary: Record<string, unknown>, now: Date): Promise<void>
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

type GoogleAdsUploadPlan =
  | { kind: 'click'; conversion: Record<string, unknown> }
  | { kind: 'call'; conversion: Record<string, unknown> }
  | { kind: 'skip'; reason: string; hardFailure?: boolean }

class SupabaseOutboxStore implements OutboxStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly maxAttempts: number,
  ) {}

  async listRows(limit: number): Promise<PpcConversionOutboxExportRow[]> {
    return this.queryCandidateRows(limit)
  }

  async claimRows(limit: number, now: Date): Promise<PpcConversionOutboxExportRow[]> {
    const candidates = await this.queryCandidateRows(limit)
    const claimed: PpcConversionOutboxExportRow[] = []

    for (const row of candidates) {
      const { data, error } = await this.client
        .from('ppc_conversion_outbox')
        .update({
          status: 'processing',
          locked_at: now.toISOString(),
          last_error: null,
          attempts: Number(row.attempts ?? 0) + 1,
        })
        .eq('id', row.id)
        .in('status', ['pending', 'failed'])
        .select('*')
        .maybeSingle()

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

  private async queryCandidateRows(limit: number): Promise<PpcConversionOutboxExportRow[]> {
    const { data, error } = await this.client
      .from('ppc_conversion_outbox')
      .select('*')
      .or(`approved_for_google_ads.eq.true,event_name.in.(${GOOGLE_ADS_FACTUAL_PPC_EVENT_NAMES.join(',')})`)
      .in('status', ['pending', 'failed'])
      .lt('attempts', this.maxAttempts)
      .order('event_time', { ascending: true })
      .limit(Math.min(100, limit * 3))

    if (error) throw new Error(error.message)
    return ((data ?? []) as PpcConversionOutboxExportRow[])
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

function readEnabledDestinations(env: Env): { destinations: Set<DestinationResult['destination']>; missing: string[] } {
  const raw = readEnv(env, 'PPC_CONVERSION_EXPORT_DESTINATIONS')
  if (!raw) return { destinations: new Set(['google_ads', 'stape']), missing: [] }

  const values = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  const destinations = new Set<DestinationResult['destination']>()
  for (const value of values) {
    if (value === 'google_ads' || value === 'stape') destinations.add(value)
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
  if (googleAds && stape) return 'google_ads_and_stape'
  if (googleAds) return 'google_ads_only'
  if (stape) return 'stape_only'
  return 'not_configured'
}

export function getPpcConversionExportConfigHealth(env: Env = process.env): PpcConversionExportConfigHealth {
  const enabled = readEnabledDestinations(env)
  const googleEnabled = enabled.destinations.has('google_ads')
  const stapeEnabled = enabled.destinations.has('stape')
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
  const googleReady = Boolean(google.config && missingActionMappings.length === 0)
  const stapeReady = Boolean(stape.config)
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

  return {
    configured: (googleEnabled && googleReady) || (stapeEnabled && stapeReady),
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

  if (!row.click_id || !row.click_id_type) {
    return {
      kind: 'skip',
      reason: `Missing click id for ${row.event_name}`,
      hardFailure: row.optimization_role === 'primary',
    }
  }

  return {
    kind: 'click',
    conversion: cleanJsonRecord({
      ...base,
      [row.click_id_type]: row.click_id,
      orderId: truncateOrderId(row.dedupe_key),
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
): DestinationResult[] {
  if (!isGoogleAdsExportablePpcEvent(row.event_name)) {
    const detail = nonExportablePpcEventReason(row.event_name)
    return [
      ...(stapeConfig ? [{ destination: 'stape' as const, status: 'skipped' as const, detail }] : []),
      ...(googleConfig ? [{ destination: 'google_ads' as const, status: 'skipped' as const, detail }] : []),
    ]
  }

  const conversionValue = googleAdsConversionValue(row)
  if (!conversionValue) {
    const detail = missingQualityScoreReason(row)
    return [
      ...(stapeConfig ? [{ destination: 'stape' as const, status: 'skipped' as const, detail }] : []),
      ...(googleConfig ? [{ destination: 'google_ads' as const, status: 'failed' as const, detail }] : []),
    ]
  }

  const destinations: DestinationResult[] = []
  if (stapeConfig) destinations.push({ destination: 'stape', status: 'would_send', detail: stapeConfig.endpoint })

  if (googleConfig) {
    const plan = buildGoogleAdsUploadPlan(row, googleConfig)
    destinations.push(
      plan.kind === 'skip'
        ? { destination: 'google_ads', status: 'skipped', detail: plan.reason }
        : { destination: 'google_ads', status: 'would_send', detail: plan.kind },
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
  const missingConfig = [...enabled.missing, ...google.missing, ...stape.missing]

  if (!google.config && !stape.config) {
    return emptyExportResult({ dryRun, configured: false, missingConfig })
  }

  const store = deps.store ?? new SupabaseOutboxStore(supabaseAdmin(), maxAttempts)
  const rows = readOnly
    ? await store.listRows(batchSize, now)
    : await store.claimRows(batchSize, now)

  const results: RowExportResult[] = []
  let tokenPromise: Promise<string> | null = null

  for (const row of rows) {
    if (dryRun) {
      const destinations = plannedDestinations(row, google.config, stape.config)
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
      if (validateOnly) {
        results.push({ id: row.id, eventName: row.event_name, status: 'pending', destinations })
        continue
      }
      const summary = rowSummary(row, destinations, now)
      await store.markSkipped(row, 'Awaiting approval for Google Ads export', summary, now)
      results.push({ id: row.id, eventName: row.event_name, status: 'skipped', destinations })
      continue
    }

    if (!isGoogleAdsExportablePpcEvent(row.event_name)) {
      const detail = nonExportablePpcEventReason(row.event_name)
      const destinations: DestinationResult[] = [
        ...(stape.config ? [{ destination: 'stape' as const, status: 'skipped' as const, detail }] : []),
        ...(google.config ? [{ destination: 'google_ads' as const, status: 'skipped' as const, detail }] : []),
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
    if (!conversionValue) {
      const detail = missingQualityScoreReason(row)
      const destinations: DestinationResult[] = [
        ...(stape.config ? [{ destination: 'stape' as const, status: 'skipped' as const, detail }] : []),
        ...(google.config ? [{ destination: 'google_ads' as const, status: 'failed' as const, detail }] : []),
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
        validateOnly
          ? { destination: 'stape', status: 'would_send', detail: 'Validate-only run; Stape request not sent' }
          : await sendStapeEvent(row, stape.config, fetchFn),
      )
    }

    if (google.config) {
      const plan = buildGoogleAdsUploadPlan(row, google.config)
      if (plan.kind === 'skip') {
        destinations.push({ destination: 'google_ads', status: plan.hardFailure ? 'failed' : 'skipped', detail: plan.reason })
      } else {
        tokenPromise = tokenPromise ?? getGoogleAdsAccessToken(google.config, fetchFn)
        const accessToken = await tokenPromise
        destinations.push(
          await uploadGoogleAdsConversion(
            row,
            plan,
            google.config,
            accessToken,
            fetchFn,
            validateOnly,
          ),
        )
      }
    }

    const failed = destinations.filter((destination) => destination.status === 'failed')
    const sent = destinations.filter((destination) => destination.status === 'sent')
    const summary = rowSummary(row, destinations, now)

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
    sent: results.filter((result) => result.status === 'sent').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
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
    sent: 0,
    skipped: 0,
    failed: 0,
    pending: 0,
    missingConfig: input.missingConfig,
    results: [],
  }
}

const PPC_EVENT_NAMES: PpcConversionEventName[] = GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES
