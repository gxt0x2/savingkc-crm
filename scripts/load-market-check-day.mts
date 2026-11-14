#!/usr/bin/env node
/**
 * Load the newest Heartland Matrix day folder.
 *
 * The folder is /workspace/mls-exports/<YYYY-MM-DD>/ unless --root is set.
 * A complete set is Active/Coming Soon, Pending, Sold, and Expired.
 * Dry run unless --confirm. Does not fetch MLS data.
 *
 *   npx tsx scripts/load-market-check-day.mts --root /workspace/mls-exports
 *   npx tsx scripts/load-market-check-day.mts --root /workspace/mls-exports --confirm
 */

import { loadNewestMatrixDay } from '../src/lib/market-check/day-load'
import { runMatrixLoad, syncMarketFlags } from '../src/lib/market-check/run'
import { createClient } from '@supabase/supabase-js'

function arg(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : ''
  return value && !value.startsWith('--') ? value : ''
}

const root = arg('--root') || '/workspace/mls-exports'
const day = loadNewestMatrixDay(root)
if (!day) {
  console.error(`No YYYY-MM-DD Matrix folder under ${root}`)
  process.exit(1)
}

const csvText = day.files.map((file) => file.text.trim()).join('\n')
console.log(JSON.stringify({
  date: day.date,
  parts: day.parts,
  missing: day.missing,
  complete: day.complete,
  files: day.files.map((file) => file.name),
}))
if (!process.argv.includes('--confirm')) {
  console.log('Dry run. Pass --confirm to write.')
  process.exit(0)
}
if (!day.complete) {
  console.error('Refusing to mark the day complete. Missing parts or the 4:00am Chicago lock has passed.')
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to confirm.')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })
await syncMarketFlags(db)
const result = await runMatrixLoad(db, {
  csvText,
  fileName: `${day.date}-matrix-day.csv`,
  actor: 'market-check-day',
  completeSet: day.complete,
  parts: day.parts,
})
console.log(JSON.stringify(result))
