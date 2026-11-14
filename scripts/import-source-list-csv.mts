#!/usr/bin/env node
/**
 * Import one source-list CSV into the CRM.
 *
 * Dry run by default. Add --confirm to write. The write calls
 * import_source_list_v1, which upserts by parcel or case id and records the
 * file. It does not send messages and it does not touch the dialer queue.
 *
 *   npx tsx scripts/import-source-list-csv.mts \
 *     --file ./jackson-tax.csv \
 *     --list-type tax_delinquent \
 *     --county jackson \
 *     --state MO \
 *     --pull-date 2026-11-14
 *
 * Environment, already used by the CRM. This script does not invent values:
 *   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { buildSourceListImport, SourceListImportError } from '../src/lib/source-lists/csv'
import { importSourceList } from '../src/lib/source-lists/import-source-list'

function loadEnvFile(path: string) {
  try {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split('\n')) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
      if (!match || process.env[match[1]]) continue
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // A missing .env.local is fine when the variables are already exported.
  }
}

function arg(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : ''
  return value && !value.startsWith('--') ? value : ''
}

loadEnvFile('.env.local')

const file = arg('--file')
const listType = arg('--list-type')
const county = arg('--county')
const state = arg('--state')
const violationKind = arg('--violation-kind')
const pullDate = arg('--pull-date')
const sourceUrl = arg('--source-url')
const notes = arg('--notes')
const actor = arg('--actor') || 'source-list-import'

if (!file || !listType || !pullDate) {
  console.error('Required: --file, --list-type, and --pull-date.')
  console.error('Optional: --county, --state, --violation-kind, --source-url, --notes, --actor, --confirm.')
  process.exit(1)
}

let csvText = ''
try {
  csvText = readFileSync(file, 'utf8')
} catch {
  console.error('Could not read the CSV file.')
  process.exit(1)
}

const request = {
  listType,
  county,
  state,
  violationKind,
  pullDate,
  sourceUrl,
  notes,
  fileName: file,
  csvText,
}

if (!process.argv.includes('--confirm')) {
  try {
    const payload = buildSourceListImport(actor, request)
    console.log(JSON.stringify({
      dryRun: true,
      listType: payload.p_list_type,
      county: payload.p_county,
      state: payload.p_state,
      violationKind: payload.p_violation_kind,
      pullDate: payload.p_pull_date,
      fileName: payload.p_source_file_name,
      sha256: payload.p_source_file_sha256,
      rows: payload.p_rows.length,
    }, null, 2))
    console.log('Re-run with --confirm to write this file.')
    process.exit(0)
  } catch (error) {
    console.error(error instanceof SourceListImportError ? error.message : 'The CSV could not be read.')
    process.exit(1)
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.')
  process.exit(1)
}

try {
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await importSourceList(db, actor, request)
  console.log(JSON.stringify(result))
} catch (error) {
  console.error(error instanceof SourceListImportError ? error.message : 'The import failed.')
  process.exit(1)
}
