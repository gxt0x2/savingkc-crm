#!/usr/bin/env node
/**
 * Enrichment Gap Diagnostic — READ-ONLY.
 *
 * Reports what enrichment work is needed before the pipeline rescore. Use
 * this BEFORE running scripts/full-enrichment-backfill.mjs so you know the
 * scope (and what changed after).
 *
 * Inputs:
 *   Env file with production Supabase keys. Tries (in order):
 *     - $TRIAGE_ENV_FILE
 *     - $HOME/savingkc-crm/.env.live
 *     - $HOME/savingkc-crm/.env.production.live
 *     - $HOME/savingkc-crm/.env.local
 *
 * Output: human-readable summary on stdout. With --json, also writes a
 * structured snapshot for diff-vs-after-backfill comparison.
 *
 * Usage:
 *   node scripts/enrichment-diagnostic.mjs
 *   node scripts/enrichment-diagnostic.mjs --json > diagnostic-before.json
 *   TRIAGE_ENV_FILE=.env.live node scripts/enrichment-diagnostic.mjs
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

// ─── Env loader ─────────────────────────────────────────────────────────────

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return false
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
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
for (const candidate of envCandidates) {
  if (loadEnv(candidate)) { envUsed = candidate; break }
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ No working Supabase env found. Set TRIAGE_ENV_FILE to a file containing')
  console.error('   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  console.error('   Tried:')
  for (const c of envCandidates) console.error(`     ${c}`)
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

// ─── Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')

// ─── Helpers ────────────────────────────────────────────────────────────────

async function countWhere(table, fn) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true })
  if (fn) q = fn(q)
  const { count, error } = await q
  if (error) throw new Error(`${table}: ${error.message}`)
  return count ?? 0
}

const ALL_STATIONS = [
  'intake', 'new', 'not_contacted',
  'attempting_contact', 'contacted',
  'qualifying', 'qualified', 'discovery',
  'appointment', 'appt_set', 'appointment_set',
  'offer', 'offer_prep', 'offer_made', 'offer_presented', 'negotiating', 'negotiations',
  'contract', 'contract_signed', 'under_contract', 'inspection', 'closing_prep', 'closing',
  'closed', 'closed_won', 'closed_lost',
  'nurture', 'disposition', 'dead',
  null,
]

// ─── Run ────────────────────────────────────────────────────────────────────

const snapshot = {
  generatedAt: new Date().toISOString(),
  envFile: envUsed,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
}

const log = (...a) => { if (!jsonMode) console.log(...a) }

log(`\n=== Enrichment Diagnostic ===`)
log(`env file: ${envUsed}`)
log(`supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

// 1. Lead inventory
log('\n── Lead inventory ──')
snapshot.leads = { total: await countWhere('leads') }
log(`  total leads: ${snapshot.leads.total}`)

// 2. By station
log('\n── By station ──')
snapshot.byStation = {}
for (const s of ALL_STATIONS) {
  const c = await countWhere('leads', q => s === null ? q.is('station', null) : q.eq('station', s))
  if (c > 0) {
    snapshot.byStation[s ?? 'null'] = c
    log(`  ${(s ?? 'null').padEnd(28)} ${c}`)
  }
}

// 3. Manifests
log('\n── Manifests ──')
snapshot.manifests = {
  total: await countWhere('manifests'),
}
const leadsTotal = snapshot.leads.total
snapshot.manifests.coveragePct = leadsTotal > 0 ? +(100 * snapshot.manifests.total / leadsTotal).toFixed(1) : 0
log(`  manifests on file: ${snapshot.manifests.total}  (${snapshot.manifests.coveragePct}% of leads)`)

// 4. Mojo queue
log('\n── Mojo queue ──')
snapshot.mojoQueue = {
  total: await countWhere('mojo_call_queue'),
  withLeadId: await countWhere('mojo_call_queue', q => q.not('lead_id', 'is', null)),
  unlinked: await countWhere('mojo_call_queue', q => q.is('lead_id', null)),
}
log(`  total rows:        ${snapshot.mojoQueue.total}`)
log(`  linked to lead:    ${snapshot.mojoQueue.withLeadId}`)
log(`  unlinked (orphan): ${snapshot.mojoQueue.unlinked}`)

// 5. Sus data signals
log('\n── Sus data signals ──')
snapshot.susData = {
  placeholderNames: await countWhere('leads', q =>
    q.or('full_name.ilike.%voicemail caller%,full_name.ilike.%unknown caller%,full_name.ilike.%inbound caller%,full_name.is.null')),
  noPropertyAddress: await countWhere('leads', q => q.is('property_address', null)),
  noPhone: await countWhere('leads', q => q.is('phone', null)),
  noPhoneAndNoAddress: await countWhere('leads', q => q.is('phone', null).is('property_address', null)),
}
log(`  placeholder names (Voicemail/Unknown/Inbound): ${snapshot.susData.placeholderNames}`)
log(`  no property_address:                            ${snapshot.susData.noPropertyAddress}`)
log(`  no phone:                                       ${snapshot.susData.noPhone}`)
log(`  no phone AND no address:                        ${snapshot.susData.noPhoneAndNoAddress}`)

// 6. Mojo sync lag (from state file)
log('\n── Mojo sync lag ──')
snapshot.mojoSyncLag = {}
try {
  const stateFile = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-sync-state.json'
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  const ageMs = Date.now() - new Date(s.lastSync).getTime()
  const ageDays = ageMs / 86400000
  snapshot.mojoSyncLag = {
    lastActivityId: s.lastActivityId,
    lastSync: s.lastSync,
    ageDays: +ageDays.toFixed(1),
  }
  log(`  lastActivityId: ${s.lastActivityId}`)
  log(`  lastSync:       ${s.lastSync}  (${ageDays.toFixed(1)} days ago)`)
  if (ageDays > 1) log(`  ⚠️  Mojo sync is stale by ${ageDays.toFixed(1)} days — run scripts/mojo-sync.mjs first`)
} catch (e) {
  log(`  unable to read state file: ${e.message}`)
  snapshot.mojoSyncLag.error = e.message
}

// 7. Manifest content gaps — sample 200 manifests, count missing pieces
log('\n── Manifest content gaps (sample of 500) ──')
const SAMPLE_SIZE = 500
const { data: sampleManifests } = await supabase
  .from('manifests')
  .select('lead_id, manifest')
  .limit(SAMPLE_SIZE)

const gaps = {
  sampleSize: sampleManifests?.length ?? 0,
  noTranscripts: 0,
  transcriptsPendingTranscription: 0,
  transcriptsMissingAnalysis: 0,
  noDwellingBedrooms: 0,
  noAssessmentTotalValue: 0,
  noParcel: 0,
  noTaxCollector: 0,
  noOwnerName: 0,
  noSituationType: 0,
  noOpportunityFlags: 0,
}
for (const row of sampleManifests ?? []) {
  const m = row.manifest ?? {}
  const t = m.communications?.transcripts ?? []
  if (t.length === 0) gaps.noTranscripts++
  if (t.some(x => x.recordingUrl && (!x.fullTranscript || x.transcriptionPending))) gaps.transcriptsPendingTranscription++
  if (t.some(x => x.fullTranscript && !x.extractedData)) gaps.transcriptsMissingAnalysis++
  if (!m.property?.dwelling?.bedrooms) gaps.noDwellingBedrooms++
  if (!m.property?.assessment?.totalValue) gaps.noAssessmentTotalValue++
  if (!m.property?.parcel) gaps.noParcel++
  if (!m.property?.taxCollector?.totalOwed && !m.property?.taxCollector?.delinquentAmount) gaps.noTaxCollector++
  if (!m.owner?.firstName || m.owner.firstName === 'Unknown') gaps.noOwnerName++
  if (!m.situation?.type || m.situation.type.length === 0) gaps.noSituationType++
  if (!m.flags?.opportunityFlags || m.flags.opportunityFlags.length === 0) gaps.noOpportunityFlags++
}
snapshot.manifestGaps = gaps
const pct = (n) => gaps.sampleSize > 0 ? `${(100 * n / gaps.sampleSize).toFixed(0)}%` : '?'
log(`  sample size:                       ${gaps.sampleSize}`)
log(`  no transcripts at all:             ${gaps.noTranscripts}  (${pct(gaps.noTranscripts)})`)
log(`  transcripts pending transcription: ${gaps.transcriptsPendingTranscription}  (${pct(gaps.transcriptsPendingTranscription)})`)
log(`  transcripts missing AI analysis:   ${gaps.transcriptsMissingAnalysis}  (${pct(gaps.transcriptsMissingAnalysis)})`)
log(`  no dwelling.bedrooms (county gap): ${gaps.noDwellingBedrooms}  (${pct(gaps.noDwellingBedrooms)})`)
log(`  no assessment.totalValue:          ${gaps.noAssessmentTotalValue}  (${pct(gaps.noAssessmentTotalValue)})`)
log(`  no parcel id:                      ${gaps.noParcel}  (${pct(gaps.noParcel)})`)
log(`  no tax collector data:             ${gaps.noTaxCollector}  (${pct(gaps.noTaxCollector)})`)
log(`  no owner name or 'Unknown':        ${gaps.noOwnerName}  (${pct(gaps.noOwnerName)})`)
log(`  no situation.type tags:            ${gaps.noSituationType}  (${pct(gaps.noSituationType)})`)
log(`  no opportunity flags:              ${gaps.noOpportunityFlags}  (${pct(gaps.noOpportunityFlags)})`)

// 8. Placeholder-name examples
log('\n── Top placeholder-name leads (sample 10) ──')
const { data: ph } = await supabase
  .from('leads')
  .select('id, full_name, phone, station, priority, created_at')
  .or('full_name.ilike.%voicemail caller%,full_name.ilike.%unknown caller%,full_name.ilike.%inbound caller%')
  .order('created_at', { ascending: false })
  .limit(10)
snapshot.placeholderSamples = (ph ?? []).map(l => ({ id: l.id, full_name: l.full_name, phone: l.phone, station: l.station, priority: l.priority }))
for (const l of ph ?? []) {
  log(`  ${l.id.slice(0,8)}  ${(l.full_name ?? '').padEnd(30)} ${(l.station ?? '').padEnd(20)} ${l.priority ?? ''}`)
}

// ─── Output ─────────────────────────────────────────────────────────────────

if (jsonMode) {
  process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n')
} else {
  log('\n=== Done. To save a JSON snapshot for diffing post-backfill: ===')
  log(`  node scripts/enrichment-diagnostic.mjs --json > diagnostic-before.json`)
}
