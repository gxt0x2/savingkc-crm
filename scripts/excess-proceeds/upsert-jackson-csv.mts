#!/usr/bin/env node
/**
 * Upsert Jackson County excess-proceeds rows into Deal Files.
 *
 * Idempotent on Suit No + Parcel No. Re-running the same CSV updates county
 * facts and leaves the Deal File stage where it is.
 *
 * Dry run (no database):
 *   npx tsx scripts/excess-proceeds/upsert-jackson-csv.mts --dry-run ./jackson.csv
 *
 * Write, using the service role already configured for this CRM:
 *   npx tsx scripts/excess-proceeds/upsert-jackson-csv.mts ./jackson.csv --actor ernest@savingkc.com
 *
 * Expected columns include Suit No, Parcel No, Owner, address, Date Sold,
 * Excess, Confirmed, Deed, Set Aside, Refund, Excess App Filed, and Excess Paid.
 * Zestimate is stored only when the file also has an as-of date.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { parseJacksonExcessProceedsCsv } from '../../src/lib/excess-proceeds/csv'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const actorFlag = args.indexOf('--actor')
const actor = actorFlag >= 0 ? args[actorFlag + 1] : 'excess-proceeds-import'
const filePath = args.find((arg) => !arg.startsWith('--') && arg !== actor)

if (!filePath) {
  console.error('Usage: npx tsx scripts/excess-proceeds/upsert-jackson-csv.mts [--dry-run] [--actor email] <file.csv>')
  process.exit(1)
}

const parsed = parseJacksonExcessProceedsCsv(readFileSync(filePath, 'utf8'))
console.log(JSON.stringify({
  ready: parsed.rows.length,
  errors: parsed.errors,
  warnings: parsed.warnings,
}, null, 2))

if (parsed.rows.length === 0) process.exit(parsed.errors.length ? 1 : 0)
if (dryRun) process.exit(0)

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before writing.')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await supabase.rpc('upsert_jackson_excess_proceeds_batch_v1', {
  target_rows: parsed.rows,
  target_actor: actor,
})
if (error) {
  console.error(error.message)
  process.exit(1)
}
console.log(JSON.stringify(data, null, 2))
