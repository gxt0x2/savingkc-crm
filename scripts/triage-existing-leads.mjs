#!/usr/bin/env node
/**
 * Lead Triage — DRY RUN.
 *
 * Pulls every lead + manifest from Supabase, runs the triageLead() classifier,
 * and emits a CSV to stdout (or --out <file>) with a verdict per lead.
 *
 * This script is READ-ONLY. It does not modify any leads. After reviewing the
 * CSV with Ernest, a follow-up script will apply the verdicts (park / dead).
 *
 * Usage:
 *   node scripts/triage-existing-leads.mjs                   # CSV to stdout
 *   node scripts/triage-existing-leads.mjs --out triage.csv  # CSV to file
 *   node scripts/triage-existing-leads.mjs --summary         # counts only
 *   node scripts/triage-existing-leads.mjs --limit 100       # cap rows
 *   node scripts/triage-existing-leads.mjs --verdict park    # filter rows
 *
 * Requires `npx tsx` because the classifier is TypeScript.
 *   npx tsx scripts/triage-existing-leads.mjs --out triage-2026-05-12.csv
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

// ─── Env loader (matches scripts/backfill-mojo-leads.mjs convention) ─────────

const ENV_PATH = path.join(process.env.HOME ?? '', 'savingkc-crm', '.env.local')
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([^=:#]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// ─── Classifier import (TS) ──────────────────────────────────────────────────

const { triageLead, triageToCsvRow, TRIAGE_CSV_HEADER } = await import(
  '../src/lib/lead-triage.ts'
)

// ─── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function arg(name, def = undefined) {
  const i = args.indexOf(name)
  if (i === -1) return def
  const next = args[i + 1]
  if (!next || next.startsWith('--')) return true
  return next
}

const outFile = arg('--out')
const summaryOnly = arg('--summary') === true
const limit = Number(arg('--limit')) || null
const verdictFilter = arg('--verdict')
const verbose = arg('--verbose') === true

// ─── Run ─────────────────────────────────────────────────────────────────────

const supabase = createClient(supabaseUrl, supabaseKey)

console.error(`[triage] Fetching leads from ${supabaseUrl} ...`)

// Pull only fields we need from leads
let leadsQuery = supabase
  .from('leads')
  .select('id, full_name, phone, station, is_parked')
  .order('created_at', { ascending: false })

if (limit) leadsQuery = leadsQuery.limit(limit)

const { data: leads, error: leadsErr } = await leadsQuery
if (leadsErr) {
  console.error('❌ Failed to fetch leads:', leadsErr.message)
  process.exit(1)
}
console.error(`[triage] Got ${leads.length} leads. Fetching manifests in batches...`)

// Fetch manifests by lead_id in batches of 200
async function fetchManifests(leadIds) {
  const out = new Map()
  const BATCH = 200
  for (let i = 0; i < leadIds.length; i += BATCH) {
    const chunk = leadIds.slice(i, i + BATCH)
    const { data, error } = await supabase
      .from('manifests')
      .select('lead_id, manifest')
      .in('lead_id', chunk)
    if (error) {
      console.error('  manifest batch error:', error.message)
      continue
    }
    for (const row of data ?? []) out.set(row.lead_id, row.manifest)
    if (verbose) console.error(`  batch ${i / BATCH + 1}: +${data?.length ?? 0}`)
  }
  return out
}

const manifestMap = await fetchManifests(leads.map(l => l.id))
console.error(`[triage] Got ${manifestMap.size} manifests`)

// ─── Classify ────────────────────────────────────────────────────────────────

const counts = { keep: 0, park: 0, dead: 0, no_manifest: 0 }
const reasonCounts = new Map()
const rows = []

for (const lead of leads) {
  const manifest = manifestMap.get(lead.id)
  if (!manifest) {
    counts.no_manifest++
    continue
  }
  const result = triageLead(manifest)
  counts[result.verdict]++
  reasonCounts.set(result.reason, (reasonCounts.get(result.reason) ?? 0) + 1)

  if (verdictFilter && result.verdict !== verdictFilter) continue
  rows.push(triageToCsvRow(lead, result))
}

// ─── Output ──────────────────────────────────────────────────────────────────

if (summaryOnly) {
  console.log('\n=== Triage Dry Run — Summary ===')
  console.log(`Total leads:        ${leads.length}`)
  console.log(`Leads w/o manifest: ${counts.no_manifest}`)
  console.log(`  → keep:  ${counts.keep}`)
  console.log(`  → park:  ${counts.park}`)
  console.log(`  → dead:  ${counts.dead}`)
  console.log('\nBy reason:')
  const sorted = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])
  for (const [reason, n] of sorted) console.log(`  ${String(n).padStart(5)}  ${reason}`)
  process.exit(0)
}

const csv = [TRIAGE_CSV_HEADER, ...rows].join('\n')

if (outFile) {
  fs.writeFileSync(outFile, csv + '\n')
  console.error(`[triage] Wrote ${rows.length} rows to ${outFile}`)
  console.error(`        keep=${counts.keep}  park=${counts.park}  dead=${counts.dead}  no_manifest=${counts.no_manifest}`)
} else {
  process.stdout.write(csv + '\n')
}
