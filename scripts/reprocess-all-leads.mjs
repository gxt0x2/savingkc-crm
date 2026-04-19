#!/usr/bin/env node
/**
 * Reprocess all leads through the unified intelligence pipeline.
 *
 * Walks the leads table in updated_at ASC order (oldest first), calls
 * /api/leads/{id}/reprocess for each, and writes results to a JSONL
 * progress log so the run can be resumed.
 *
 * Usage:
 *   node scripts/reprocess-all-leads.mjs [--dry-run] [--limit N] [--since ISODATE]
 *                                        [--filter source=VALUE] [--force] [--concurrency N]
 *
 * Flags:
 *   --dry-run          Print the lead count that would be processed; don't call the endpoint.
 *   --limit N          Stop after N leads.
 *   --since ISODATE    Only leads with updated_at >= this.
 *   --filter source=X  Only leads matching leads.source = X (e.g. mojo_call).
 *   --force            Ignore the progress log; re-run leads already processed.
 *   --concurrency N    Max in-flight requests (default 3).
 *   --base-url URL     Override http://localhost:3000.
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const envFile = fs.readFileSync('/Users/ernestdodson/savingkc-crm/.env.local', 'utf8')
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=:#]+)=(.*)$/)
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
})

// ─── flags ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function flag(name, hasValue = false) {
  const i = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (i === -1) return hasValue ? null : false
  if (!hasValue) return true
  const arg = args[i]
  if (arg.includes('=')) return arg.split('=').slice(1).join('=')
  const next = args[i + 1]
  if (next && !next.startsWith('--')) return next
  return null
}

const DRY_RUN = flag('dry-run')
const LIMIT = flag('limit', true) ? parseInt(flag('limit', true), 10) : null
const SINCE = flag('since', true)
const FILTER = flag('filter', true)
const FORCE = flag('force')
const CONCURRENCY = flag('concurrency', true) ? parseInt(flag('concurrency', true), 10) : 3
const BASE_URL = flag('base-url', true) || 'http://localhost:3000'
const RECENT_HOURS = 24 // skip leads reprocessed within this window unless --force

const PROGRESS_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), '.reprocess-progress.jsonl')

// ─── supabase ────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

// ─── progress log ────────────────────────────────────────────────────────
function loadProgress() {
  if (!fs.existsSync(PROGRESS_PATH)) return new Map()
  const map = new Map()
  const lines = fs.readFileSync(PROGRESS_PATH, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      const row = JSON.parse(line)
      map.set(row.leadId, row)
    } catch { /* skip malformed */ }
  }
  return map
}

function appendProgress(row) {
  fs.appendFileSync(PROGRESS_PATH, JSON.stringify(row) + '\n')
}

function recentlyProcessed(progress, leadId) {
  const row = progress.get(leadId)
  if (!row) return false
  const ageHours = (Date.now() - new Date(row.processedAt).getTime()) / 3_600_000
  return ageHours < RECENT_HOURS
}

// ─── lead query ──────────────────────────────────────────────────────────
async function fetchLeads(offset, pageSize) {
  let q = supabase
    .from('leads')
    .select('id, full_name, updated_at, source')
    .order('updated_at', { ascending: true })
    .range(offset, offset + pageSize - 1)

  if (SINCE) q = q.gte('updated_at', SINCE)
  if (FILTER) {
    const [key, val] = FILTER.split('=')
    if (key && val) q = q.eq(key, val)
  }

  const { data, error } = await q
  if (error) throw new Error(`Supabase error: ${error.message}`)
  return data || []
}

async function countLeads() {
  let q = supabase.from('leads').select('id', { count: 'exact', head: true })
  if (SINCE) q = q.gte('updated_at', SINCE)
  if (FILTER) {
    const [key, val] = FILTER.split('=')
    if (key && val) q = q.eq(key, val)
  }
  const { count, error } = await q
  if (error) throw new Error(`Count error: ${error.message}`)
  return count || 0
}

// ─── reprocess call ──────────────────────────────────────────────────────
async function reprocessOne(leadId) {
  const started = Date.now()
  try {
    const res = await fetch(`${BASE_URL}/api/leads/${leadId}/reprocess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suppressNotifications: true }),
    })
    const elapsed = Date.now() - started
    if (!res.ok) {
      const text = await res.text()
      return { leadId, ok: false, status: res.status, error: text.slice(0, 500), elapsedMs: elapsed }
    }
    const body = await res.json()
    return { leadId, ok: true, elapsedMs: elapsed, ...body }
  } catch (err) {
    return { leadId, ok: false, error: err.message, elapsedMs: Date.now() - started }
  }
}

// ─── concurrency pool ────────────────────────────────────────────────────
async function runPool(items, worker, concurrency) {
  const results = []
  let i = 0
  async function next() {
    while (i < items.length) {
      const idx = i++
      const out = await worker(items[idx])
      results[idx] = out
    }
  }
  const runners = Array.from({ length: concurrency }, () => next())
  await Promise.all(runners)
  return results
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Reprocess All Leads ===')
  console.log(`  base_url=${BASE_URL}`)
  console.log(`  dry_run=${DRY_RUN} limit=${LIMIT || 'none'} since=${SINCE || 'none'} filter=${FILTER || 'none'} force=${FORCE} concurrency=${CONCURRENCY}`)

  const total = await countLeads()
  console.log(`  total_matching_leads=${total}`)

  if (DRY_RUN) {
    console.log('\nDry run — exiting without reprocessing.')
    return
  }

  const progress = FORCE ? new Map() : loadProgress()
  console.log(`  prior_progress_entries=${progress.size}`)

  const PAGE = 100
  let offset = 0
  let attempted = 0
  let ok = 0
  let failed = 0
  let skipped = 0
  const errors = []

  const startedAt = Date.now()

  while (true) {
    const leads = await fetchLeads(offset, PAGE)
    if (leads.length === 0) break

    const toProcess = leads.filter(l => FORCE || !recentlyProcessed(progress, l.id))
    skipped += leads.length - toProcess.length

    const results = await runPool(toProcess, async (lead) => {
      // rate limit between starts — gentle on Playwright
      await new Promise(r => setTimeout(r, 500))
      const result = await reprocessOne(lead.id)
      const row = {
        leadId: lead.id,
        fullName: lead.full_name,
        source: lead.source,
        ok: result.ok,
        opportunityScore: result.opportunityScore ?? null,
        changed: result.changed ?? [],
        errors: result.errors ?? (result.error ? [result.error] : []),
        processedAt: new Date().toISOString(),
        elapsedMs: result.elapsedMs,
      }
      appendProgress(row)
      progress.set(lead.id, row)
      if (result.ok) {
        process.stdout.write(`✓ ${lead.id.slice(0, 8)} ${lead.full_name?.padEnd(30).slice(0, 30)} score=${result.opportunityScore ?? '—'} changed=[${(result.changed || []).join(',')}]\n`)
      } else {
        process.stdout.write(`✗ ${lead.id.slice(0, 8)} ${lead.full_name?.padEnd(30).slice(0, 30)} error=${result.error?.slice(0, 80)}\n`)
      }
      return result
    }, CONCURRENCY)

    for (const r of results) {
      attempted++
      if (r.ok) ok++
      else {
        failed++
        errors.push({ leadId: r.leadId, error: r.error })
      }
    }

    offset += PAGE
    if (LIMIT && attempted >= LIMIT) break
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log('\n=== Summary ===')
  console.log(`  attempted=${attempted} ok=${ok} failed=${failed} skipped_recent=${skipped}`)
  console.log(`  elapsed=${elapsed}s progress_log=${PROGRESS_PATH}`)

  if (errors.length > 0) {
    console.log('\n=== First 10 failures ===')
    for (const e of errors.slice(0, 10)) {
      console.log(`  ${e.leadId}: ${(e.error || '').slice(0, 120)}`)
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
