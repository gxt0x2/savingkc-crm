/**
 * Clear the old first-party campaign default on rows that have no paid evidence.
 *
 * Before the writer fix, ppc_tracking_events.campaign was filled with
 * "Search 2026" whenever utm_campaign was missing, including direct traffic.
 * This script sets campaign to null only when the stored name is still
 * "Search 2026" and the row has no utm_campaign and no click id
 * (gclid, gbraid, wbraid, msclkid) or paid medium (cpc, ppc, paid), including
 * those values inside payload. Rows with real paid evidence are left alone.
 * Test flags are not changed.
 *
 * This file does not run on import, deploy, or test. A normal invocation is a
 * dry run and prints the rows it would change. Pass --write to update them.
 *
 *   npx tsx scripts/backfill-unproven-search-2026-campaigns.mts
 *   npx tsx scripts/backfill-unproven-search-2026-campaigns.mts --write
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { unprovenStoredSearchCampaign } from '../src/lib/ppc/tracking-events'

const PAGE = 500
const WRITE_CHUNK = 100

type TrackingRow = Record<string, unknown> & { id?: string }

function loadEnvFile(name: string) {
  const path = resolve(name)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key]) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function clientFromEnv(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim()
  if (!url || !key) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function selectUnprovenSearchCampaigns(client: SupabaseClient): Promise<TrackingRow[]> {
  const matches: TrackingRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await client
      .from('ppc_tracking_events')
      .select('id, campaign, utm_campaign, utm_medium, gclid, gbraid, wbraid, payload')
      .eq('campaign', 'Search 2026')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as TrackingRow[]
    matches.push(...page.filter(unprovenStoredSearchCampaign))
    if (page.length < PAGE) break
    from += PAGE
  }
  return matches
}

async function clearCampaigns(client: SupabaseClient, ids: string[]) {
  for (let index = 0; index < ids.length; index += WRITE_CHUNK) {
    const chunk = ids.slice(index, index + WRITE_CHUNK)
    const { error } = await client
      .from('ppc_tracking_events')
      .update({ campaign: null })
      .in('id', chunk)
      .eq('campaign', 'Search 2026')
    if (error) throw new Error(error.message)
  }
}

async function main() {
  loadEnvFile('.env.local')
  loadEnvFile('.env')
  const write = process.argv.includes('--write')
  const client = clientFromEnv()
  const matches = await selectUnprovenSearchCampaigns(client)
  const ids = matches.map((row) => row.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (write) await clearCampaigns(client, ids)
  console.log(JSON.stringify({
    ok: true,
    dryRun: !write,
    matched: ids.length,
    updated: write ? ids.length : 0,
    sampleIds: ids.slice(0, 10),
    writeHint: write ? null : 'Re-run with --write to set campaign to null on the matched rows. Proven paid rows are not matched.',
  }, null, 2))
}

const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false
if (isDirectRun) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
  })
}
