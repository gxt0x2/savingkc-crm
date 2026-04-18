#!/usr/bin/env node
/**
 * Mojo queue health snapshot.
 *
 * Usage:
 *   node scripts/mojo-queue-status.mjs            # today's snapshot
 *   node scripts/mojo-queue-status.mjs --watch    # refresh every 30s
 *   node scripts/mojo-queue-status.mjs --since=2h # last 2 hours (m|h|d)
 *
 * Reads SUPABASE creds from .env.local.
 */

import fs from 'fs'
import path from 'path'

const ENV_PATH = path.join(process.cwd(), '.env.local')
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const args = process.argv.slice(2)
const watch = args.includes('--watch')
const sinceArg = args.find(a => a.startsWith('--since='))?.split('=')[1] || '24h'

function parseSince(s) {
  const m = s.match(/^(\d+)(m|h|d)$/)
  if (!m) return 24 * 3600 * 1000
  const n = Number(m[1])
  return n * ({ m: 60, h: 3600, d: 86400 }[m[2]]) * 1000
}

const sinceMs = parseSince(sinceArg)
const sinceIso = () => new Date(Date.now() - sinceMs).toISOString()

async function sb(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'count=exact',
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const data = await res.json()
  const count = Number(res.headers.get('content-range')?.split('/')[1] ?? data.length)
  return { data, count }
}

function fmtAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

function pad(s, n) { return String(s).padEnd(n) }

async function snapshot() {
  const since = sinceIso()
  const statusWindow = `mojo_call_queue?select=status&created_at=gte.${since}`
  const latest = `mojo_call_queue?select=id,record_id,status,attempts,last_error,created_at,completed_at,lead_id,manifest_id,opportunity_score&order=created_at.desc&limit=10`
  const deadLetter = `mojo_call_queue?select=record_id,last_error,attempts,created_at&status=eq.dead_letter&order=created_at.desc&limit=5`
  const stale = `mojo_call_queue?select=record_id,attempts,processing_started_at&status=eq.processing&processing_started_at=lt.${new Date(Date.now() - 5 * 60 * 1000).toISOString()}`
  const manifestsRecent = `manifests?select=id,created_at,priority,qualification_score&created_at=gte.${since}&order=created_at.desc&limit=5`
  const appts = `manifests?select=id,manifest,created_at&manifest->pipeline->appointment=not.is.null&created_at=gte.${since}&order=created_at.desc&limit=5`

  const [windowRows, latestRows, dead, staleRows, manifests, apptRows] = await Promise.all([
    sb(statusWindow), sb(latest), sb(deadLetter), sb(stale), sb(manifestsRecent), sb(appts),
  ])

  const counts = windowRows.data.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {})

  console.clear()
  console.log(`\n  Mojo queue snapshot — ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT`)
  console.log(`  Window: last ${sinceArg}\n`)

  console.log('  Status counts:')
  for (const s of ['pending', 'processing', 'completed', 'failed', 'dead_letter']) {
    const n = counts[s] || 0
    const mark = (s === 'dead_letter' && n > 0) || (s === 'failed' && n > 0) ? ' ⚠' : ''
    console.log(`    ${pad(s, 14)} ${n}${mark}`)
  }

  if (staleRows.count > 0) {
    console.log(`\n  ⚠ ${staleRows.count} stuck "processing" items (>5min old) — next cron will reset them`)
    for (const r of staleRows.data.slice(0, 3)) {
      console.log(`    ${r.record_id} attempts=${r.attempts} since=${fmtAgo(r.processing_started_at)}`)
    }
  }

  if (dead.count > 0) {
    console.log(`\n  ⚠ Dead-lettered (all-time):`)
    for (const r of dead.data) {
      console.log(`    ${r.record_id}  ${fmtAgo(r.created_at)}  ${r.last_error?.slice(0, 80) || ''}`)
    }
  }

  console.log('\n  Last 10 queue rows:')
  for (const r of latestRows.data) {
    const score = r.opportunity_score != null ? `score=${r.opportunity_score}` : ''
    const when = r.completed_at ? fmtAgo(r.completed_at) : fmtAgo(r.created_at)
    console.log(`    ${pad(r.status, 10)} ${pad(r.record_id, 32)} ${when.padEnd(8)} ${score}`)
  }

  console.log(`\n  Manifests created in window: ${manifests.count}`)
  for (const m of manifests.data) {
    console.log(`    ${pad(m.priority || '-', 6)} q=${m.qualification_score ?? '-'}  ${fmtAgo(m.created_at)}`)
  }

  console.log(`\n  Appointments in window: ${apptRows.count}`)
  for (const m of apptRows.data) {
    const appt = m.manifest?.pipeline?.appointment
    if (appt) console.log(`    ${appt.scheduledAt || '?'}  ${appt.type || ''}  ${appt.notes?.slice(0, 60) || ''}`)
  }

  console.log()
}

async function main() {
  if (!watch) {
    await snapshot()
    return
  }
  while (true) {
    try { await snapshot() } catch (e) { console.error(e.message) }
    await new Promise(r => setTimeout(r, 30_000))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
