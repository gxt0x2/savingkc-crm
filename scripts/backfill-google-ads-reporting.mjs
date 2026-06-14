#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_API_VERSION = 'v24'
const DEFAULT_SINCE = '2026-05-01'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ENV_FILES = ['.env.local', '.env', '.env.development.local']

const args = parseArgs(process.argv.slice(2))
loadEnvFiles(args.envFile ? [args.envFile, ...ENV_FILES] : ENV_FILES)

const since = args.since || process.env.GOOGLE_ADS_BACKFILL_SINCE || DEFAULT_SINCE
const until = args.until || process.env.GOOGLE_ADS_BACKFILL_UNTIL || todayIsoDate()
const write = Boolean(args.write)
const dryRun = !write
const includeSearchTerms = args.searchTerms !== 'false' && args.searchTerms !== '0'

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    dryRun,
    since,
    until,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2))
  process.exit(1)
})

async function main() {
  assertDate('since', since)
  assertDate('until', until)
  if (since > until) throw new Error(`since date ${since} is after until date ${until}`)

  const config = readGoogleAdsConfig()
  const supabase = needsSupabase(config) ? createSupabaseAdminClient() : null
  const runId = write ? await startSyncRun(supabase, since, until, dryRun) : null

  try {
    const accessToken = await getGoogleAdsAccessToken(config, supabase)
    const campaignRows = await fetchCampaignDailyRows(config, accessToken, since, until)
    const searchTermRows = includeSearchTerms
      ? await fetchSearchTermDailyRows(config, accessToken, since, until)
      : []

    if (write) {
      await upsertInChunks(supabase, 'google_ads_campaign_daily', campaignRows, 'date,customer_id,campaign_id')
      await upsertInChunks(supabase, 'google_ads_search_term_daily', searchTermRows, 'dedupe_key')
      await finishSyncRun(supabase, runId, {
        status: 'success',
        campaignRows: campaignRows.length,
        searchTermRows: searchTermRows.length,
      })
    }

    console.log(JSON.stringify({
      ok: true,
      dryRun,
      since,
      until,
      customerId: config.customerId,
      apiVersion: config.apiVersion,
      campaignRows: campaignRows.length,
      searchTermRows: searchTermRows.length,
      sample: {
        campaigns: campaignRows.slice(0, 3),
        searchTerms: searchTermRows.slice(0, 3),
      },
      writeHint: dryRun ? 'Re-run with --write after the migration is applied to Supabase.' : null,
    }, null, 2))
  } catch (error) {
    if (write && runId) {
      await finishSyncRun(supabase, runId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {})
    }
    throw error
  }
}

function loadEnvFiles(files) {
  for (const file of files) {
    const path = file.startsWith('/') ? file : resolve(process.cwd(), file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key] != null) continue
      process.env[key] = unquote(rawValue.trim())
    }
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--write') {
      parsed.write = true
      continue
    }
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    parsed[key] = inlineValue ?? argv[index + 1]
    if (inlineValue == null) index += 1
  }
  return parsed
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function assertDate(label, value) {
  if (!DATE_RE.test(value)) throw new Error(`${label} must be YYYY-MM-DD`)
}

function digits(value) {
  const cleaned = String(value || '').replace(/\D/g, '')
  return cleaned || null
}

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function readGoogleAdsConfig() {
  const config = {
    apiVersion: readEnv('GOOGLE_ADS_API_VERSION') || DEFAULT_API_VERSION,
    customerId: digits(readEnv('GOOGLE_ADS_CUSTOMER_ID')),
    loginCustomerId: digits(readEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'GOOGLE_ADS_MANAGER_CUSTOMER_ID')),
    developerToken: readEnv('GOOGLE_ADS_DEVELOPER_TOKEN'),
    clientId: readEnv('GOOGLE_ADS_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: readEnv('GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET'),
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

function needsSupabase(config) {
  return !dryRun || Boolean(config.refreshTokenUserEmail)
}

function createSupabaseAdminClient() {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = readEnv('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY')
  const missing = [
    ['NEXT_PUBLIC_SUPABASE_URL', url],
    ['SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY', serviceKey],
  ].filter(([, value]) => !value).map(([key]) => key)

  if (missing.length) {
    throw new Error(`Missing Supabase config: ${missing.join(', ')}`)
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function getGoogleAdsAccessToken(config, supabase) {
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
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `Google OAuth failed (${response.status})`)
  }
  return body.access_token
}

async function readSavedGoogleAdsRefreshToken(config, supabase) {
  if (!supabase) throw new Error('Supabase is required to read GOOGLE_ADS_REFRESH_TOKEN_USER_EMAIL')
  const { data, error } = await supabase
    .from('user_oauth_tokens')
    .select('refresh_token, scope')
    .eq('provider', 'google_ads')
    .eq('user_email', config.refreshTokenUserEmail)
    .maybeSingle()

  if (error) throw new Error(`Google Ads OAuth lookup failed: ${error.message}`)
  if (!data?.refresh_token) throw new Error(`No saved Google Ads refresh token for ${config.refreshTokenUserEmail}`)
  if (!String(data.scope || '').split(/\s+/).includes('https://www.googleapis.com/auth/adwords')) {
    throw new Error(`Saved token for ${config.refreshTokenUserEmail} is missing the adwords scope`)
  }
  return data.refresh_token
}

async function googleAdsSearchStream(config, accessToken, query) {
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
  return body.flatMap((chunk) => Array.isArray(chunk.results) ? chunk.results : [])
}

function cleanHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => Boolean(value)))
}

function summarizeGoogleAdsError(body, fallback) {
  if (typeof body?.error === 'string') return body.error
  if (body?.error?.message) return body.error.message
  return fallback
}

async function fetchCampaignDailyRows(config, accessToken, sinceDate, untilDate) {
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
    const campaign = row.campaign || {}
    const metrics = row.metrics || {}
    return {
      date: row.segments?.date,
      customer_id: config.customerId,
      campaign_id: stringValue(campaign.id),
      campaign_name: stringValue(campaign.name),
      campaign_status: stringValue(campaign.status),
      advertising_channel_type: stringValue(campaign.advertisingChannelType),
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

async function fetchSearchTermDailyRows(config, accessToken, sinceDate, untilDate) {
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
    const campaign = row.campaign || {}
    const adGroup = row.adGroup || {}
    const metrics = row.metrics || {}
    const keyword = row.segments?.keyword?.info || {}
    const mapped = {
      date: row.segments?.date,
      customer_id: config.customerId,
      campaign_id: stringValue(campaign.id),
      campaign_name: stringValue(campaign.name),
      ad_group_id: stringValue(adGroup.id),
      ad_group_name: stringValue(adGroup.name),
      search_term: stringValue(row.searchTermView?.searchTerm),
      keyword_text: stringValue(keyword.text) || null,
      keyword_match_type: stringValue(keyword.matchType) || null,
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

function stringValue(value) {
  if (value == null) return ''
  return String(value)
}

function integerValue(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

function numberValue(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function searchTermDedupeKey(row) {
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

async function upsertInChunks(supabase, table, rows, onConflict) {
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

async function startSyncRun(supabase, sinceDate, untilDate, isDryRun) {
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
  return data.id
}

async function finishSyncRun(supabase, runId, result) {
  if (!runId) return
  const patch = {
    finished_at: new Date().toISOString(),
    status: result.status,
    campaign_rows: result.campaignRows ?? 0,
    search_term_rows: result.searchTermRows ?? 0,
    error: result.error ?? null,
  }
  const { error } = await supabase
    .from('google_ads_reporting_sync_runs')
    .update(patch)
    .eq('id', runId)
  if (error) throw new Error(`sync run update failed: ${error.message}`)
}
