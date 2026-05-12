#!/usr/bin/env node
/**
 * Full Enrichment Backfill — HTTP-only orchestrator.
 *
 * Drives the new POST /api/admin/reprocess-all-leads endpoint in batches.
 * This avoids needing direct Supabase access from the runner — the
 * production CRM has working DB credentials and does all the heavy lifting
 * server-side (Mojo queue load, transcript fill, prospect hydration,
 * county scrape, re-score, manifest cascade).
 *
 * Resumable via state file: tracks the offset processed so far. Re-running
 * picks up where it stopped (or use --offset N to start at a specific row).
 *
 * Auth: Bearer token via CRM_ADMIN_SECRET / CRON_SECRET / ADMIN_API_SECRET
 * env var, or --bearer arg.
 *
 * Usage:
 *   # Dry-run: count + first page of candidates, no mutations
 *   node scripts/full-enrichment-backfill.mjs --dry-run
 *
 *   # Live run, default batch 25, full lead set
 *   ADMIN_API_SECRET=... node scripts/full-enrichment-backfill.mjs
 *
 *   # Stale-only (touched < 30d ago, faster pass)
 *   node scripts/full-enrichment-backfill.mjs --stale-only
 *
 *   # Resume after interruption
 *   node scripts/full-enrichment-backfill.mjs --resume
 *
 *   # Specific leads
 *   node scripts/full-enrichment-backfill.mjs --lead-ids id1,id2,id3
 *
 *   # Slow down (1 batch every 30s)
 *   node scripts/full-enrichment-backfill.mjs --pause-between 30
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

// ─── Env loader ─────────────────────────────────────────────────────────────

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return false
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^=:#]+)=(.*)$/)
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return true
}

const HOME = process.env.HOME ?? ''
for (const c of [
  process.env.TRIAGE_ENV_FILE,
  path.join(HOME, 'savingkc-crm', '.env.production.live'),
  path.join(HOME, 'savingkc-crm', '.env.live'),
  path.join(HOME, 'savingkc-crm', '.env.local'),
].filter(Boolean)) {
  loadEnv(c)
}

const CRM_BASE = (process.env.CRM_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/$/, '')

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
const staleOnly = arg('--stale-only') === true
const skipMojo = arg('--skip-mojo-sync') === true
const resume = arg('--resume') === true
const batchSize = Number(arg('--batch-size')) || 25
const pauseSec = Number(arg('--pause-between')) || 2
const startOffset = Number(arg('--offset')) || 0
const maxBatches = Number(arg('--max-batches')) || Infinity
const bearerOverride = arg('--bearer')
const leadIdsArg = arg('--lead-ids')

const bearer = (bearerOverride !== true ? bearerOverride : null)
  || process.env.CRM_ADMIN_SECRET
  || process.env.ADMIN_API_SECRET
  || process.env.CRON_SECRET
  || process.env.DEPLOY_SECRET

if (!bearer) {
  console.error('❌ No admin bearer token. Set ADMIN_API_SECRET (or CRON_SECRET) or pass --bearer.')
  process.exit(1)
}

// ─── State / logs ───────────────────────────────────────────────────────────

const STATE_FILE = path.join(HOME, '.openclaw', 'workspace', 'memory', 'enrichment-backfill-state.json')
const LOG_DIR = path.join(HOME, 'savingkc-crm', 'logs')
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')
const CSV_PATH = path.join(LOG_DIR, `enrichment-backfill-${RUN_ID}.csv`)
const JSON_PATH = path.join(LOG_DIR, `enrichment-backfill-${RUN_ID}.jsonl`)

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { lastOffset: 0, totalProcessed: 0, totalFailed: 0, runs: [] }
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
  catch { return { lastOffset: 0, totalProcessed: 0, totalFailed: 0, runs: [] } }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ─── Mojo sync ──────────────────────────────────────────────────────────────

async function runMojoSync() {
  return new Promise((resolve) => {
    const scriptPath = path.join(HOME, 'savingkc-crm', 'scripts', 'mojo-sync.mjs')
    if (!fs.existsSync(scriptPath)) {
      console.error(`  mojo-sync.mjs not found at ${scriptPath} — skipping`)
      return resolve()
    }
    console.log(`[1/3] Running mojo-sync.mjs to catch up Mojo activity...`)
    const child = spawn('node', [scriptPath], { stdio: 'inherit' })
    child.on('close', code => {
      if (code !== 0) console.error(`  mojo-sync.mjs exited ${code} — continuing anyway`)
      resolve()
    })
  })
}

// ─── HTTP call to admin endpoint ────────────────────────────────────────────

async function postBatch(payload) {
  const res = await fetch(`${CRM_BASE}/api/admin/reprocess-all-leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  return body
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log(`=== Full Enrichment Backfill (HTTP path) ===`)
console.log(`CRM base:      ${CRM_BASE}`)
console.log(`mode:          ${dryRun ? 'DRY RUN' : 'LIVE'}`)
console.log(`batch size:    ${batchSize}`)
console.log(`pause between: ${pauseSec}s`)
console.log(`stale-only:    ${staleOnly}`)
console.log(`bearer set:    yes (${bearer.length} chars)`)
console.log(`csv:           ${CSV_PATH}`)
console.log(`state:         ${STATE_FILE}`)
console.log()

// Step 1: Mojo catch-up
if (!skipMojo && !dryRun) {
  await runMojoSync()
} else {
  console.log(`[1/3] Mojo sync ${dryRun ? 'skipped (dry run)' : 'skipped (--skip-mojo-sync)'}`)
}

// Step 2: Specific lead IDs path
if (leadIdsArg && leadIdsArg !== true) {
  const ids = String(leadIdsArg).split(',').map(s => s.trim()).filter(Boolean)
  console.log(`\n[2/3] Specific-IDs mode: ${ids.length} leads`)
  const r = await postBatch({ leadIds: ids, dryRun, refreshTranscripts: true, forceReEnrich: true })
  console.log(JSON.stringify(r, null, 2))
  process.exit(0)
}

// Step 3: Paginated batch processing
const state = resume ? loadState() : { lastOffset: startOffset, totalProcessed: 0, totalFailed: 0, runs: [] }
if (resume) console.log(`  resume: starting at offset ${state.lastOffset} (prior runs processed ${state.totalProcessed})`)

let offset = state.lastOffset
let batchesRun = 0
const t0 = Date.now()
let totalSeenInRun = 0
let totalDoneInRun = 0
let totalFailInRun = 0

fs.writeFileSync(CSV_PATH,
  'lead_id,ok,elapsed_ms,changed,skipped,errors,opportunity_score\n')

console.log(`\n[3/3] Starting batches @ ${batchSize}/batch, offset=${offset}\n`)

while (batchesRun < maxBatches) {
  let batch
  try {
    batch = await postBatch({
      offset,
      limit: batchSize,
      staleOnly,
      dryRun,
      refreshTranscripts: true,
      forceReEnrich: true,
    })
  } catch (err) {
    console.error(`\n❌ Batch failed at offset ${offset}: ${err.message}`)
    break
  }

  batchesRun++
  totalSeenInRun += batch.processedThisCall ?? 0
  for (const r of batch.results ?? []) {
    if (r.ok) totalDoneInRun++
    else totalFailInRun++
    fs.appendFileSync(CSV_PATH, [
      r.leadId, r.ok, r.elapsedMs,
      (r.changed ?? []).join('|'),
      (r.skipped ?? []).join('|'),
      r.error || (r.errors ?? []).join('|'),
      r.opportunityScore ?? '',
    ].map(csvEscape).join(',') + '\n')
    fs.appendFileSync(JSON_PATH, JSON.stringify(r) + '\n')
  }

  const elapsedMin = (Date.now() - t0) / 60000
  const totalCandidates = batch.totalCandidates ?? '?'
  console.log(`  batch ${batchesRun}  offset=${offset}  processed=${batch.processedThisCall}  done=${totalDoneInRun}  fail=${totalFailInRun}  total=${totalCandidates}  elapsed=${elapsedMin.toFixed(1)}min`)

  if (dryRun) {
    console.log(`  [dry-run] candidates in this page:`)
    for (const c of batch.candidates ?? []) console.log(`    ${c.id}  ${(c.name ?? '').padEnd(28)}  ${c.station ?? ''}`)
  }

  if (batch.nextOffset === null || batch.nextOffset === undefined) {
    console.log(`\n✅ No more candidates — done.`)
    break
  }
  offset = batch.nextOffset

  // Save state every batch
  state.lastOffset = offset
  state.totalProcessed += totalDoneInRun
  state.totalFailed += totalFailInRun
  saveState(state)

  if (pauseSec > 0 && batchesRun < maxBatches) {
    await new Promise(r => setTimeout(r, pauseSec * 1000))
  }
}

state.lastOffset = offset
state.totalProcessed += totalDoneInRun
state.totalFailed += totalFailInRun
state.runs.push({ runId: RUN_ID, batches: batchesRun, processed: totalDoneInRun, failed: totalFailInRun, elapsedMin: (Date.now() - t0) / 60000 })
saveState(state)

console.log()
console.log(`=== Done ===`)
console.log(`  batches run:      ${batchesRun}`)
console.log(`  leads seen:       ${totalSeenInRun}`)
console.log(`  succeeded:        ${totalDoneInRun}`)
console.log(`  failed:           ${totalFailInRun}`)
console.log(`  total time:       ${((Date.now() - t0) / 60000).toFixed(1)} min`)
console.log(`  per-lead CSV:     ${CSV_PATH}`)
console.log(`  per-lead JSONL:   ${JSON_PATH}`)
console.log(`  next offset:      ${offset}  (use --resume to continue)`)
console.log()
console.log(`Next:`)
console.log(`  1. Eyeball the CSV for unexpected 'errors' values`)
console.log(`  2. Run scripts/detect-stuck-stations.mjs to surface station mismatches`)
console.log(`  3. Merge #121 (canonical pipeline), trigger full rerank`)
console.log(`  4. Run scripts/triage-existing-leads.mjs --summary`)
