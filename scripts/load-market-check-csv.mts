#!/usr/bin/env node
/**
 * Load one metro-wide Heartland Matrix saved-search CSV.
 *
 * Dry run unless --confirm. Does not fetch MLS data and does not use CRON_SECRET.
 *
 *   npx tsx scripts/load-market-check-csv.mts --file ./data/mls-inbox/matrix.csv
 *   npx tsx scripts/load-market-check-csv.mts --file ./data/mls-inbox/matrix.csv --confirm
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { fileSha256, parseMatrixCsv } from '../src/lib/market-check/matrix-csv'
import { planMarketCheck } from '../src/lib/market-check/plan'
import { additionListDay, chicagoClock, offMarketAllowed } from '../src/lib/market-check/schedule'
import { runMatrixLoad, syncMarketFlags } from '../src/lib/market-check/run'

function arg(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : ''
  return value && !value.startsWith('--') ? value : ''
}

const file = arg('--file')
if (!file) {
  console.error('Required: --file path/to/matrix.csv')
  process.exit(1)
}

const csvText = readFileSync(file, 'utf8')
const now = new Date()
const rows = parseMatrixCsv(csvText)
const preview = planMarketCheck({
  rows,
  poolRows: [],
  targetStatusByZip: new Map(),
  minListPriceByZip: new Map(),
  today: chicagoClock(now).date,
  additionListDay: additionListDay(now),
  allowOffMarket: offMarketAllowed(now),
  fileSha256: fileSha256(csvText),
})

if (!process.argv.includes('--confirm')) {
  console.log(JSON.stringify({
    dryRun: true,
    rows: rows.length,
    coveredZips: preview.coveredZips.length,
    sha256: fileSha256(csvText),
    offMarketAllowed: offMarketAllowed(now),
    note: 'Re-run with --confirm. The saved search must be metro-wide, not only the target zips. Pool matching happens on confirm.',
  }, null, 2))
  process.exit(0)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
await syncMarketFlags(db)
const result = await runMatrixLoad(db, {
  csvText,
  fileName: file.split('/').pop() || 'matrix.csv',
  actor: arg('--actor') || 'market-check-script',
  now,
})
console.log(JSON.stringify({ confirmed: true, ...result }, null, 2))
