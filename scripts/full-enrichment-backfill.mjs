#!/usr/bin/env node
/**
 * Full Enrichment Backfill — orchestrator.
 *
 * Purpose: bring every existing lead up to current enrichment state BEFORE
 * the canonical pipeline rescore (#121) and the triage dry-run (#122).
 *
 * What it does, in order:
 *   1. Catch up Mojo sync — runs scripts/mojo-sync.mjs (incremental pull from
 *      Mojo activity stream). Skip with --skip-mojo-sync.
 *   2. For every lead, POSTs /api/leads/{id}/reprocess with refreshTranscripts
 *      and forceReEnrich. The reprocess endpoint (lead-pipeline.ts:reprocessLead)
 *      handles: loading all Mojo queue rows, adding missing transcripts,
 *      merging agent notes, re-transcribing pending recordings, re-analyzing,
 *      healing split-addresses, hydrating from prospects, running county
 *      enrichment, re-scoring, cascading manifest → leads row.
 *   3. Writes a per-lead CSV + JSON log so the run is auditable and resumable.
 *
 * Resumable: tracks completed lead IDs in a state file. Re-running picks up
 * where it stopped (or use --resume-from <leadId>).
 *
 * Auth: POST to /api/leads/{id}/reprocess requires admin. Provide via:
 *   - ADMIN_API_SECRET env var
 *   - or --bearer <token> arg (overrides env)
 *
 * Usage:
 *   # Dry-run: list what would be processed (no API calls)
 *   node scripts/full-enrichment-backfill.mjs --dry-run
 *
 *   # Real run, default concurrency 3 (county scrapers are slow)
 *   node scripts/full-enrichment-backfill.mjs
 *
 *   # Fast lane — only leads that look stale
 *   node scripts/full-enrichment-backfill.mjs --stale-only
 *
 *   # Resume from interruption
 *   node scripts/full-enrichment-backfill.mjs --resume
 *
 *   # Cap for testing
 *   node scripts/full-enrichment-backfill.mjs --limit 20 --concurrency 1
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

// ─── Env loader (matches enrichment-diagnostic.mjs) ─────────────────────────

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return false
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^=:#]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return true
}

const envCandidates = [
  process.env.TRIAGE_ENV_FILE,
  path.join(process.env.HOME ?? '', 'savingkc-crm', '.env.live'),
  path.join(process.env.HOME ?? '', 'savingkc-crm', '.env.production.live'),
  path.join(process.env.HOME ?? '', 'savingkc-crm', '.env.local'),
].filter(Boolean)

let envUsed = null
for (const c of envCandidates) {
  if (loadEnv(c)) { envUsed = c; break }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRM_BASE = (process.env.CRM_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/$/, '')
const ADMIN_SECRET = process.env.ADMIN_API_SECRET || process.env.CRON_SECRET

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase env. Set TRIAGE_ENV_FILE or place .env.live in the repo root.')
  process.exit(1)
}

// ─── Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function arg(name, def) {
  const i = args.indexOf(name)
  if (i === -1) return def
  const next = args[i + 1]
  if (!next || next.startsWith('--')) return true
  return next
}

const dryRun = arg('--dry-run') === true
const skipMojo = arg('--skip-mojo-sync') === true
const staleOnly = arg('--stale-only') === true
const resume = arg('--resume') === true
const resumeFrom = arg('--resume-from')
const limit = Number(arg('--limit')) || null
const concurrency = Number(arg('--concurrency')) || 3
const bearerOverride = arg('--bearer')
const bearer = bearerOverride !== true ? (bearerOverride || ADMIN_SECRET) : ADMIN_SECRET

const STATE_FILE = path.join(process.env.HOME ?? '', '.openclaw', 'workspace', 'memory', 'enrichment-backfill-state.json')
const LOG_DIR = path.join(process.env.HOME ?? '', 'savingkc-crm', 'logs')
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
const CSV_PATH = path.join(LOG_DIR, `enrichment-backfill-${RUN_ID}.csv`)
const JSON_PATH = path.join(LOG_DIR, `enrichment-backfill-${RUN_ID}.jsonl`)

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

// ─── Helpers ────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { completed: [], failed: [], startedAt: null, runId: null }
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
  catch { return { completed: [], failed: [], startedAt: null, runId: null } }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

async function runMojoSync() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.env.HOME ?? '', 'savingkc-crm', 'scripts', 'mojo-sync.mjs')
    if (!fs.existsSync(scriptPath)) {
      console.error(`  mojo-sync.mjs not found at ${scriptPath} — skipping`)
      return resolve({ skipped: true })
    }
    console.log(`[1/3] Running mojo-sync.mjs to catch up Mojo activity...`)
    const child = spawn('node', [scriptPath], { stdio: 'inherit' })
    child.on('close', code => {
      if (code === 0) resolve({ skipped: false })
      else reject(new Error(`mojo-sync.mjs exited ${code}`))
    })
  })
}

async function reprocessLead(leadId) {
  if (!bearer) throw new Error('No admin bearer token. Set ADMIN_API_SECRET or pass --bearer.')
  const url = `${CRM_BASE}/api/leads/${leadId}/reprocess`
  const t0 = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      suppressNotifications: true,
      refreshTranscripts: true,
      forceReEnrich: true,
    }),
  })
  const elapsed = Date.now() - t0
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  if (!res.ok) {
    return { ok: false, status: res.status, elapsed, body }
  }
  return { ok: true, status: res.status, elapsed, body }
}

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ─── Lead picker ────────────────────────────────────────────────────────────

async function fetchLeadIds() {
  let q = supabase.from('leads').select('id, full_name, phone, station, updated_at')
  if (staleOnly) {
    // "stale" = no updated_at in 30 days, or station is null
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
    q = q.or(`updated_at.lt.${cutoff},station.is.null`)
  }
  q = q.order('created_at', { ascending: true })
  if (limit) q = q.limit(limit)
  const { data, error } = await q
  if (error) throw new Error(`fetchLeadIds: ${error.message}`)
  return data ?? []
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log(`=== Full Enrichment Backfill ===`)
console.log(`env file:      ${envUsed}`)
console.log(`CRM base URL:  ${CRM_BASE}`)
console.log(`mode:          ${dryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`)
console.log(`concurrency:   ${concurrency}`)
console.log(`stale-only:    ${staleOnly}`)
console.log(`limit:         ${limit ?? 'none'}`)
console.log(`bearer set:    ${bearer ? 'yes' : 'NO — will fail on first call'}`)
console.log(`run id:        ${RUN_ID}`)
console.log(`csv log:       ${CSV_PATH}`)
console.log(`state file:    ${STATE_FILE}`)
console.log()

// Step 1: Mojo sync catch-up
if (!skipMojo && !dryRun) {
  try {
    await runMojoSync()
  } catch (err) {
    console.error(`  mojo-sync.mjs failed: ${err.message}`)
    console.error(`  Continuing anyway — reprocess will use whatever Mojo data is already in the DB.`)
  }
} else {
  console.log(`[1/3] Mojo sync ${dryRun ? 'skipped (dry run)' : 'skipped (--skip-mojo-sync)'}`)
}

// Step 2: Pick leads
console.log(`\n[2/3] Fetching lead list...`)
const allLeads = await fetchLeadIds()
console.log(`  fetched: ${allLeads.length} leads`)

const state = resume ? loadState() : { completed: [], failed: [], startedAt: new Date().toISOString(), runId: RUN_ID }
if (resume) console.log(`  resume mode — ${state.completed.length} already done, ${state.failed.length} previously failed`)

let leads = allLeads
if (resume) {
  const doneSet = new Set(state.completed)
  leads = leads.filter(l => !doneSet.has(l.id))
}
if (resumeFrom && resumeFrom !== true) {
  const idx = leads.findIndex(l => l.id === resumeFrom)
  if (idx > 0) leads = leads.slice(idx)
}

console.log(`  to process:  ${leads.length}`)

if (dryRun) {
  console.log(`\n[dry run] Would POST /api/leads/{id}/reprocess for ${leads.length} leads.`)
  console.log(`  Estimated time @ concurrency ${concurrency}: ~${Math.ceil(leads.length * 8 / concurrency / 60)} minutes`)
  console.log(`  (assumes ~8s per lead — county scraping + transcription dominate)`)
  process.exit(0)
}

// Step 3: Reprocess in parallel waves
console.log(`\n[3/3] Reprocessing ${leads.length} leads at concurrency ${concurrency}...`)

fs.writeFileSync(CSV_PATH,
  'lead_id,full_name,phone,station,http_status,elapsed_ms,changed,skipped,errors,manifest_id,opportunity_score\n')

let totalDone = 0
let totalFail = 0
const t0Run = Date.now()

async function processOne(lead) {
  try {
    const r = await reprocessLead(lead.id)
    if (r.ok) {
      const b = r.body || {}
      const changedStr = (b.changed ?? []).join('|')
      const skippedStr = (b.skipped ?? []).join('|')
      const errorsStr = (b.errors ?? []).join('|')
      fs.appendFileSync(CSV_PATH, [
        lead.id, lead.full_name, lead.phone, lead.station,
        r.status, r.elapsed, changedStr, skippedStr, errorsStr,
        b.manifestId, b.opportunityScore,
      ].map(csvEscape).join(',') + '\n')
      fs.appendFileSync(JSON_PATH, JSON.stringify({ leadId: lead.id, ...r }) + '\n')
      state.completed.push(lead.id)
      totalDone++
    } else {
      fs.appendFileSync(CSV_PATH, [
        lead.id, lead.full_name, lead.phone, lead.station,
        r.status, r.elapsed, '', '', JSON.stringify(r.body),
        '', '',
      ].map(csvEscape).join(',') + '\n')
      state.failed.push({ leadId: lead.id, status: r.status, body: r.body })
      totalFail++
    }
  } catch (err) {
    fs.appendFileSync(CSV_PATH, [
      lead.id, lead.full_name, lead.phone, lead.station,
      'EXC', 0, '', '', err.message, '', '',
    ].map(csvEscape).join(',') + '\n')
    state.failed.push({ leadId: lead.id, error: err.message })
    totalFail++
  }
  // Periodic state save (every 25 leads)
  if ((totalDone + totalFail) % 25 === 0) saveState(state)
}

// Concurrency-limited workers
const queue = [...leads]
async function worker() {
  while (queue.length > 0) {
    const lead = queue.shift()
    if (!lead) break
    const idx = leads.length - queue.length
    await processOne(lead)
    const rate = totalDone / ((Date.now() - t0Run) / 1000)
    const remaining = queue.length
    const etaSec = remaining > 0 && rate > 0 ? Math.ceil(remaining / rate) : 0
    process.stdout.write(`\r  [${idx}/${leads.length}]  done=${totalDone}  fail=${totalFail}  rate=${rate.toFixed(2)}/s  eta=${Math.ceil(etaSec/60)}m   `)
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))
saveState(state)

console.log()
console.log()
console.log(`=== Done ===`)
console.log(`  total processed: ${totalDone + totalFail}`)
console.log(`  success:         ${totalDone}`)
console.log(`  failed:          ${totalFail}`)
console.log(`  total time:      ${((Date.now() - t0Run) / 60000).toFixed(1)} min`)
console.log(`  csv:             ${CSV_PATH}`)
console.log(`  jsonl:           ${JSON_PATH}`)
console.log(`  state file:      ${STATE_FILE}`)
console.log()
console.log(`Next:`)
console.log(`  1. Eyeball the CSV for unexpected 'errors' values`)
console.log(`  2. Run scripts/enrichment-diagnostic.mjs --json > diagnostic-after.json and diff against the before snapshot`)
console.log(`  3. Run scripts/detect-stuck-stations.mjs to surface leads whose station doesn't match their data`)
console.log(`  4. Merge PR #121, run the canonical rescore`)
console.log(`  5. Run scripts/triage-existing-leads.mjs --summary`)
