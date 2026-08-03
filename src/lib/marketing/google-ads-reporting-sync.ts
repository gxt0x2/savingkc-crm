import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { markOAuthConnected, persistOAuthHealth, readOAuthHealth } from '@/lib/oauth-health'

const DEFAULT_API_VERSION = 'v24'
const DEFAULT_SINCE = '2026-05-01'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type GoogleAdsReportingConfig = {
  apiVersion: string
  customerId: string
  loginCustomerId: string | null
  developerToken: string
  clientId: string
  clientSecret: string
  refreshToken: string | null
  refreshTokenUserEmail: string | null
}

type GoogleAdsRow = Record<string, unknown>

export type GoogleAdsReportingSyncOptions = {
  since?: string
  until?: string
  write?: boolean
  includeSearchTerms?: boolean
}

export type GoogleAdsReportingSyncResult = {
  ok: true
  dryRun: boolean
  since: string
  until: string
  customerId: string
  apiVersion: string
  campaignRows: number
  searchTermRows: number
  runId: string | null
}

export class GoogleAdsReauthorizationRequiredError extends Error {
  constructor(message = 'Google Ads authorization expired. Reconnect Google Ads in Settings.') {
    super(message)
    this.name = 'GoogleAdsReauthorizationRequiredError'
  }
}

function todayIsoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function assertDate(label: string, value: string) {
  if (!DATE_RE.test(value)) throw new Error(`${label} must be YYYY-MM-DD`)
}

function digits(value: string | null | undefined): string | null {
  const cleaned = String(value || '').replace(/\D/g, '')
  return cleaned || null
}

function readEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function readGoogleAdsConfig(): GoogleAdsReportingConfig {
  const config = {
    apiVersion: readEnv('GOOGLE_ADS_API_VERSION') || DEFAULT_API_VERSION,
    customerId: digits(readEnv('GOOGLE_ADS_CUSTOMER_ID')) || '',
    loginCustomerId: digits(readEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'GOOGLE_ADS_MANAGER_CUSTOMER_ID')),
    developerToken: readEnv('GOOGLE_ADS_DEVELOPER_TOKEN') || '',
    clientId: readEnv('GOOGLE_ADS_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID') || '',
    clientSecret: readEnv('GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET') || '',
    refreshToken: readEnv('GOOGLE_ADS_REFRESH_TOKEN'),
    refreshTokenUserEmail: readEnv('GOOGLE_ADS_REFRESH_TOKEN_USER_EMAIL'),
  }

  const missing = [
    ['GOOGLE_ADS_CUSTOMER_ID', config.customerId],
    ['GOOGLE_ADS_DEVELOPER_TOKEN', config.developerToken],
    ['GOOGLE_ADS_CLIENT_ID or GOOGLE_OAUTH_CLIENT_ID', config.clientId],
    ['GOOGLE_ADS_CLIENT_SECRET or GOOGLE_OAUTH_CLIENT_SECRET', config.clientSecret],
    ['GOOGLE_ADS_REFRESH_TOKEN or GOOGLE_ADS_REFRESH_TOKEN_USER_EMAIL', config.refreshToken || config.refreshTokenUserEmail],
  ].filter(([, value]) => !value).map(([key]) => key)

  if (missing.length) {
    throw new Error(`Missing Google Ads config: ${missing.join(', ')}`)
  }

  return config
}

async function getGoogleAdsAccessToken(
  config: GoogleAdsReportingConfig,
  supabase: SupabaseClient,
): Promise<string> {
  if (config.refreshTokenUserEmail) {
    const health = await readOAuthHealth(supabase, 'google_ads', config.refreshTokenUserEmail)
    if (health?.status === 'reauthorization_required') {
      throw new GoogleAdsReauthorizationRequiredError()
    }
  }
  const refreshToken = config.refreshToken || await readSavedGoogleAdsRefreshToken(config, supabase)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  const body = await response.json().catch(() => ({}))
  const token = record(body).access_token
  if (!response.ok || typeof token !== 'string' || !token) {
    const errorCode = text(record(body).error) || `oauth_http_${response.status}`
    const errorDescription = text(record(body).error_description) || 'Google OAuth token refresh failed'
    if (config.refreshTokenUserEmail) {
      await persistOAuthHealth(supabase, {
        provider: 'google_ads',
        userEmail: config.refreshTokenUserEmail,
        status: errorCode === 'invalid_grant' ? 'reauthorization_required' : 'error',
        errorCode,
        errorMessage: errorDescription,
      })
    }
    if (errorCode === 'invalid_grant') {
      throw new GoogleAdsReauthorizationRequiredError()
    }
    throw new Error(`Google Ads OAuth ${errorCode}: ${errorDescription}`)
  }
  if (config.refreshTokenUserEmail) {
    await markOAuthConnected(supabase, 'google_ads', config.refreshTokenUserEmail)
  }
  return token
}

async function readSavedGoogleAdsRefreshToken(
  config: GoogleAdsReportingConfig,
  supabase: SupabaseClient,
): Promise<string> {
  const { data, error } = await supabase
    .from('user_oauth_tokens')
    .select('refresh_token, scope')
    .eq('provider', 'google_ads')
    .eq('user_email', config.refreshTokenUserEmail)
    .maybeSingle()

  if (error) throw new Error(`Google Ads OAuth lookup failed: ${error.message}`)
  const row = record(data)
  const refreshToken = text(row.refresh_token)
  if (!refreshToken) throw new Error(`No saved Google Ads refresh token for ${config.refreshTokenUserEmail}`)
  if (!text(row.scope).split(/\s+/).includes('https://www.googleapis.com/auth/adwords')) {
    throw new Error(`Saved token for ${config.refreshTokenUserEmail} is missing the adwords scope`)
  }
  return refreshToken
}

async function googleAdsSearchStream(
  config: GoogleAdsReportingConfig,
  accessToken: string,
  query: string,
): Promise<GoogleAdsRow[]> {
  const response = await fetch(
    `https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: cleanHeaders({
        'Content-Type': 'application/json',
        'developer-token': config.developerToken,
        Authorization: `Bearer ${accessToken}`,
        'login-customer-id': config.loginCustomerId,
      }),
      body: JSON.stringify({ query }),
    },
  )
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(summarizeGoogleAdsError(body, `Google Ads searchStream failed (${response.status})`))
  }
  if (!Array.isArray(body)) return []
  return body.flatMap((chunk) => {
    const results = record(chunk).results
    return Array.isArray(results) ? results as GoogleAdsRow[] : []
  })
}

function cleanHeaders(headers: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => Boolean(value))) as Record<string, string>
}

function summarizeGoogleAdsError(body: unknown, fallback: string): string {
  const error = record(body).error
  if (typeof error === 'string') return error
  const errorRecord = record(error)
  const message = text(errorRecord.message)
  const details = Array.isArray(errorRecord.details) ? errorRecord.details : []
  const issueMessages = details.flatMap((detail) => {
    const errors = record(detail).errors
    if (!Array.isArray(errors)) return []
    return errors.map((issue) => text(record(issue).message)).filter(Boolean)
  })
  return [message || fallback, ...issueMessages].filter(Boolean).join(' | ')
}

async function fetchCampaignDailyRows(
  config: GoogleAdsReportingConfig,
  accessToken: string,
  sinceDate: string,
  untilDate: string,
): Promise<GoogleAdsRow[]> {
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.all_conversions,
      metrics.all_conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}'
    ORDER BY segments.date ASC, campaign.name ASC
  `
  const results = await googleAdsSearchStream(config, accessToken, query)
  return results.map((row) => {
    const campaign = record(row.campaign)
    const metrics = record(row.metrics)
    return {
      date: text(record(row.segments).date),
      customer_id: config.customerId,
      campaign_id: text(campaign.id),
      campaign_name: text(campaign.name),
      campaign_status: text(campaign.status),
      advertising_channel_type: text(campaign.advertisingChannelType),
      impressions: integerValue(metrics.impressions),
      clicks: integerValue(metrics.clicks),
      cost_micros: integerValue(metrics.costMicros),
      conversions: numberValue(metrics.conversions),
      conversions_value: numberValue(metrics.conversionsValue),
      all_conversions: numberValue(metrics.allConversions),
      all_conversions_value: numberValue(metrics.allConversionsValue),
      payload: row,
      imported_at: new Date().toISOString(),
    }
  }).filter((row) => row.date && row.campaign_id)
}

async function fetchSearchTermDailyRows(
  config: GoogleAdsReportingConfig,
  accessToken: string,
  sinceDate: string,
  untilDate: string,
): Promise<GoogleAdsRow[]> {
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      search_term_view.search_term,
      segments.keyword.info.text,
      segments.keyword.info.match_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.all_conversions,
      metrics.all_conversions_value
    FROM search_term_view
    WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}'
      AND metrics.impressions > 0
    ORDER BY segments.date ASC, metrics.clicks DESC
  `
  const results = await googleAdsSearchStream(config, accessToken, query)
  return results.map((row) => {
    const campaign = record(row.campaign)
    const adGroup = record(row.adGroup)
    const metrics = record(row.metrics)
    const keyword = record(record(row.segments).keyword).info
    const mapped = {
      date: text(record(row.segments).date),
      customer_id: config.customerId,
      campaign_id: text(campaign.id),
      campaign_name: text(campaign.name),
      ad_group_id: text(adGroup.id),
      ad_group_name: text(adGroup.name),
      search_term: text(record(row.searchTermView).searchTerm),
      keyword_text: text(record(keyword).text) || null,
      keyword_match_type: text(record(keyword).matchType) || null,
      impressions: integerValue(metrics.impressions),
      clicks: integerValue(metrics.clicks),
      cost_micros: integerValue(metrics.costMicros),
      conversions: numberValue(metrics.conversions),
      conversions_value: numberValue(metrics.conversionsValue),
      all_conversions: numberValue(metrics.allConversions),
      all_conversions_value: numberValue(metrics.allConversionsValue),
      payload: row,
      imported_at: new Date().toISOString(),
    }
    return {
      dedupe_key: searchTermDedupeKey(mapped),
      ...mapped,
    }
  }).filter((row) => row.date && row.campaign_id && row.ad_group_id && row.search_term)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function integerValue(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

function numberValue(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function searchTermDedupeKey(row: Record<string, unknown>): string {
  return createHash('sha256')
    .update([
      row.date,
      row.customer_id,
      row.campaign_id,
      row.ad_group_id,
      row.search_term,
      row.keyword_text || '',
      row.keyword_match_type || '',
    ].join('|'))
    .digest('hex')
}

async function upsertInChunks(
  supabase: SupabaseClient,
  table: string,
  rows: GoogleAdsRow[],
  onConflict: string,
) {
  const chunkSize = 500
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    if (!chunk.length) continue
    const { error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict })
    if (error) throw new Error(`${table} upsert failed: ${error.message}`)
  }
}

async function startSyncRun(
  supabase: SupabaseClient,
  sinceDate: string,
  untilDate: string,
  isDryRun: boolean,
): Promise<string> {
  const { data, error } = await supabase
    .from('google_ads_reporting_sync_runs')
    .insert({
      since_date: sinceDate,
      until_date: untilDate,
      dry_run: isDryRun,
      status: 'running',
    })
    .select('id')
    .single()
  if (error) throw new Error(`sync run insert failed: ${error.message}`)
  return text(record(data).id)
}

async function finishSyncRun(
  supabase: SupabaseClient,
  runId: string | null,
  result: { status: 'success' | 'failed'; campaignRows?: number; searchTermRows?: number; error?: string },
) {
  if (!runId) return
  const { error } = await supabase
    .from('google_ads_reporting_sync_runs')
    .update({
      finished_at: new Date().toISOString(),
      status: result.status,
      campaign_rows: result.campaignRows ?? 0,
      search_term_rows: result.searchTermRows ?? 0,
      error: result.error ?? null,
    })
    .eq('id', runId)
  if (error) throw new Error(`sync run update failed: ${error.message}`)
}

export async function runGoogleAdsReportingSync(
  options: GoogleAdsReportingSyncOptions = {},
): Promise<GoogleAdsReportingSyncResult> {
  const since = options.since || process.env.GOOGLE_ADS_BACKFILL_SINCE || DEFAULT_SINCE
  const until = options.until || process.env.GOOGLE_ADS_BACKFILL_UNTIL || todayIsoDate()
  const write = options.write === true
  const dryRun = !write
  const includeSearchTerms = options.includeSearchTerms !== false

  assertDate('since', since)
  assertDate('until', until)
  if (since > until) throw new Error(`since date ${since} is after until date ${until}`)

  const config = readGoogleAdsConfig()
  const supabase = supabaseAdmin()
  const runId = await startSyncRun(supabase, since, until, dryRun)

  try {
    const accessToken = await getGoogleAdsAccessToken(config, supabase)
    const campaignRows = await fetchCampaignDailyRows(config, accessToken, since, until)
    const searchTermRows = includeSearchTerms
      ? await fetchSearchTermDailyRows(config, accessToken, since, until)
      : []

    if (write) {
      await upsertInChunks(supabase, 'google_ads_campaign_daily', campaignRows, 'date,customer_id,campaign_id')
      await upsertInChunks(supabase, 'google_ads_search_term_daily', searchTermRows, 'dedupe_key')
    }

    await finishSyncRun(supabase, runId, {
      status: 'success',
      campaignRows: campaignRows.length,
      searchTermRows: searchTermRows.length,
    })

    return {
      ok: true,
      dryRun,
      since,
      until,
      customerId: config.customerId,
      apiVersion: config.apiVersion,
      campaignRows: campaignRows.length,
      searchTermRows: searchTermRows.length,
      runId,
    }
  } catch (error) {
    await finishSyncRun(supabase, runId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {})
    throw error
  }
}
