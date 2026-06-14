import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'

const DEFAULT_API_BASE = 'https://api.ads.openai.com/v1'
const DEFAULT_SINCE = '2026-06-01'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const OPENAI_ADS_INSIGHTS_LIMIT = 2000

type OpenAIAdsReportingConfig = {
  apiBase: string
  apiKey: string
}

type OpenAIAdsAccount = {
  id: string
  name: string | null
  currencyCode: string | null
  timezone: string | null
}

type OpenAIAdsRow = Record<string, unknown>

export type OpenAIAdsReportingSyncOptions = {
  since?: string
  until?: string
  write?: boolean
}

export type OpenAIAdsReportingSyncResult = {
  ok: true
  configured: boolean
  dryRun: boolean
  since: string
  until: string
  accountId: string | null
  campaignRows: number
  runId: string | null
}

function todayIsoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function latestCompletedIsoDate() {
  return addDays(todayIsoDate(), -1)
}

function assertDate(label: string, value: string) {
  if (!DATE_RE.test(value)) throw new Error(`${label} must be YYYY-MM-DD`)
}

function readEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function readOpenAIAdsConfig(): OpenAIAdsReportingConfig | null {
  const apiKey = readEnv('OPENAI_ADS_API_KEY')
  if (!apiKey) return null

  return {
    apiBase: readEnv('OPENAI_ADS_API_BASE') || DEFAULT_API_BASE,
    apiKey,
  }
}

async function openAIAdsGet(config: OpenAIAdsReportingConfig, path: string, params?: URLSearchParams): Promise<unknown> {
  const url = new URL(`${config.apiBase.replace(/\/+$/, '')}${path}`)
  if (params) {
    for (const [key, value] of params) url.searchParams.append(key, value)
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(summarizeOpenAIAdsError(body, `OpenAI Ads API failed (${response.status})`))
  }
  return body
}

function summarizeOpenAIAdsError(body: unknown, fallback: string): string {
  const error = record(body).error
  if (typeof error === 'string' && error) return error
  const message = text(record(error).message) || text(record(body).message)
  return message || fallback
}

async function fetchAdAccount(config: OpenAIAdsReportingConfig): Promise<OpenAIAdsAccount> {
  const body = record(await openAIAdsGet(config, '/ad_account'))
  const id = text(body.id)
  if (!id) throw new Error('OpenAI Ads API did not return an ad account id')

  return {
    id,
    name: text(body.name) || null,
    currencyCode: text(body.currency_code) || null,
    timezone: text(body.timezone) || null,
  }
}

async function fetchCampaignInsights(
  config: OpenAIAdsReportingConfig,
  sinceDate: string,
  untilDate: string,
  fields: string[],
): Promise<OpenAIAdsRow[]> {
  const rows: OpenAIAdsRow[] = []
  let after: string | null = null

  for (let page = 0; page < 25; page += 1) {
    const params = new URLSearchParams()
    params.set('time_granularity', 'daily')
    params.set('aggregation_level', 'campaign')
    params.set('limit', String(OPENAI_ADS_INSIGHTS_LIMIT))
    params.append('time_ranges[]', JSON.stringify({ type: 'date_range', since: sinceDate, until: untilDate }))
    for (const field of fields) params.append('fields[]', field)
    if (after) params.set('after', after)

    const body = record(await openAIAdsGet(config, '/ad_account/insights', params))
    const data = Array.isArray(body.data) ? body.data : []
    rows.push(...data.filter((row): row is OpenAIAdsRow => Boolean(row && typeof row === 'object' && !Array.isArray(row))))

    if (body.has_more !== true) break
    after = text(body.last_id) || text(body.after)
    if (!after) break
  }

  return rows
}

async function fetchCampaignDailyRows(
  config: OpenAIAdsReportingConfig,
  account: OpenAIAdsAccount,
  sinceDate: string,
  untilDate: string,
): Promise<OpenAIAdsRow[]> {
  const baseFields = ['readable_time', 'campaign_id', 'campaign_name', 'impressions', 'clicks', 'spend']
  const fieldsWithConversions = [...baseFields, 'conversions']
  let rows: OpenAIAdsRow[]

  try {
    rows = await fetchCampaignInsights(config, sinceDate, untilDate, fieldsWithConversions)
  } catch (error) {
    if (!/field|conversion|unsupported|invalid/i.test(error instanceof Error ? error.message : String(error))) {
      throw error
    }
    rows = await fetchCampaignInsights(config, sinceDate, untilDate, baseFields)
  }

  const importedAt = new Date().toISOString()
  return rows
    .map((row) => {
      const date = insightDate(row)
      const campaignId = text(row.campaign_id) || text(row.id)
      const costMicros = spendMicros(row)
      const conversions = numberValue(row.conversions)
      return {
        date,
        account_id: account.id,
        account_name: account.name,
        campaign_id: campaignId,
        campaign_name: text(row.campaign_name) || text(row.name) || 'OpenAI Ads',
        impressions: integerValue(row.impressions),
        clicks: integerValue(row.clicks),
        cost_micros: costMicros,
        spend_amount: costMicros / 1_000_000,
        conversions,
        all_conversions: conversions,
        currency_code: account.currencyCode,
        timezone: account.timezone,
        payload: row,
        imported_at: importedAt,
      }
    })
    .filter((row) => row.date && row.account_id && row.campaign_id)
}

function insightDate(row: OpenAIAdsRow): string {
  const direct = text(row.readable_time) || text(row.date)
  if (DATE_RE.test(direct)) return direct
  if (/^\d{4}-\d{2}-\d{2}/.test(direct)) return direct.slice(0, 10)

  const startTime = row.start_time
  if (typeof startTime === 'number' && Number.isFinite(startTime)) {
    const millis = startTime > 10_000_000_000 ? startTime : startTime * 1000
    return new Date(millis).toISOString().slice(0, 10)
  }

  const parsed = Date.parse(text(startTime))
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10)
}

function spendMicros(row: OpenAIAdsRow): number {
  for (const key of ['cost_micros', 'costMicros', 'spend_micros', 'spendMicros']) {
    const micros = numberValue(row[key])
    if (micros > 0) return Math.trunc(micros)
  }
  return Math.trunc(numberValue(row.spend) * 1_000_000)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function integerValue(value: unknown): number {
  const number = numberValue(value)
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

async function upsertInChunks(
  supabase: SupabaseClient,
  table: string,
  rows: OpenAIAdsRow[],
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
    .from('openai_ads_reporting_sync_runs')
    .insert({
      since_date: sinceDate,
      until_date: untilDate,
      dry_run: isDryRun,
      status: 'running',
    })
    .select('id')
    .single()
  if (error) throw new Error(`OpenAI Ads sync run insert failed: ${error.message}`)
  return text(record(data).id)
}

async function finishSyncRun(
  supabase: SupabaseClient,
  runId: string | null,
  result: { status: 'success' | 'failed'; campaignRows?: number; error?: string; account?: OpenAIAdsAccount },
) {
  if (!runId) return
  const { error } = await supabase
    .from('openai_ads_reporting_sync_runs')
    .update({
      finished_at: new Date().toISOString(),
      status: result.status,
      campaign_rows: result.campaignRows ?? 0,
      error: result.error ?? null,
      metadata: {
        account_id: result.account?.id ?? null,
        account_name: result.account?.name ?? null,
        currency_code: result.account?.currencyCode ?? null,
      },
    })
    .eq('id', runId)
  if (error) throw new Error(`OpenAI Ads sync run update failed: ${error.message}`)
}

export async function runOpenAIAdsReportingSync(
  options: OpenAIAdsReportingSyncOptions = {},
): Promise<OpenAIAdsReportingSyncResult> {
  const since = options.since || process.env.OPENAI_ADS_BACKFILL_SINCE || DEFAULT_SINCE
  const until = options.until || process.env.OPENAI_ADS_BACKFILL_UNTIL || latestCompletedIsoDate()
  const write = options.write === true
  const dryRun = !write

  assertDate('since', since)
  assertDate('until', until)
  if (since > until) throw new Error(`since date ${since} is after until date ${until}`)

  const config = readOpenAIAdsConfig()
  if (!config) {
    return {
      ok: true,
      configured: false,
      dryRun,
      since,
      until,
      accountId: null,
      campaignRows: 0,
      runId: null,
    }
  }

  const supabase = supabaseAdmin()
  const runId = await startSyncRun(supabase, since, until, dryRun)

  try {
    const account = await fetchAdAccount(config)
    const campaignRows = await fetchCampaignDailyRows(config, account, since, until)

    if (write) {
      await upsertInChunks(supabase, 'openai_ads_campaign_daily', campaignRows, 'date,account_id,campaign_id')
    }

    await finishSyncRun(supabase, runId, {
      status: 'success',
      campaignRows: campaignRows.length,
      account,
    })

    return {
      ok: true,
      configured: true,
      dryRun,
      since,
      until,
      accountId: account.id,
      campaignRows: campaignRows.length,
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
