#!/usr/bin/env node
/**
 * Stuck-Station Detector — READ-ONLY.
 *
 * Finds leads whose manifest data implies a station different from what's
 * actually set on the lead row. Surfaces them to a CSV for manual review.
 * NEVER auto-mutates — station changes are too consequential to automate
 * (e.g. moving a lead to `under_contract` triggers different alerting,
 * KPI counts, and reporting downstream).
 *
 * Detection rules:
 *   A. Lead has manifest.closing.tc_file_id OR audit-trail action
 *      'contract_signed' OR notes containing "contract signed" but station
 *      is NOT under_contract / closed_* / dead → "should be under_contract"
 *
 *   B. Lead has pipeline.appointment with status in
 *      {scheduled, confirmed, reconfirmed} but station is in
 *      {new, contacted, intake} → "should be at appointment_set"
 *
 *   C. Lead has scoring.opportunity_score >= 75 + motivation.score >= 60
 *      but station is `new`/`intake` → "should be at qualified or further"
 *
 *   D. Lead has lastDisposition in {dnc, wrong_number, not_interested,
 *      already_sold} but station is NOT dead/closed_lost → "should be dead"
 *
 *   E. Lead has financials.offer_amount + offer sent timestamp in
 *      audit trail but station is NOT offer_made/under_contract → "should
 *      be at offer_made"
 *
 * Usage:
 *   node scripts/detect-stuck-stations.mjs              # human summary
 *   node scripts/detect-stuck-stations.mjs --csv > stuck.csv
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

// Env loader (same convention as the others)
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return false
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^=:#]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return true
}
for (const c of [
  process.env.TRIAGE_ENV_FILE,
  path.join(process.env.HOME ?? '', 'savingkc-crm', '.env.live'),
  path.join(process.env.HOME ?? '', 'savingkc-crm', '.env.production.live'),
  path.join(process.env.HOME ?? '', 'savingkc-crm', '.env.local'),
].filter(Boolean)) {
  if (loadEnv(c)) break
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase env')
  process.exit(1)
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Args
const args = process.argv.slice(2)
const csvMode = args.includes('--csv')

// ─── Pull leads + manifests ─────────────────────────────────────────────────

console.error('[stuck-stations] Fetching leads...')
const { data: leads } = await supabase.from('leads').select('id, full_name, phone, station, priority')

console.error(`[stuck-stations] Got ${leads?.length ?? 0} leads. Fetching manifests in batches...`)
const manifestMap = new Map()
const BATCH = 200
for (let i = 0; i < (leads?.length ?? 0); i += BATCH) {
  const chunk = leads.slice(i, i + BATCH).map(l => l.id)
  const { data } = await supabase.from('manifests').select('lead_id, manifest').in('lead_id', chunk)
  for (const row of data ?? []) manifestMap.set(row.lead_id, row.manifest)
}

// ─── Detection rules ────────────────────────────────────────────────────────

const TERMINAL = new Set(['under_contract', 'closed', 'closed_won', 'closed_lost', 'dead'])
const EARLY = new Set(['new', 'intake', 'not_contacted', null])
const HARD_NO_DISPOS = new Set(['dnc', 'wrong_number', 'not_interested', 'already_sold', 'bad_number', 'disconnected'])

const findings = []

function add(lead, manifest, suggested, reason, evidence) {
  findings.push({
    lead_id: lead.id,
    full_name: lead.full_name ?? '',
    phone: lead.phone ?? '',
    current_station: lead.station ?? 'null',
    suggested_station: suggested,
    reason,
    evidence,
  })
}

for (const lead of leads ?? []) {
  const m = manifestMap.get(lead.id)
  if (!m) continue
  const station = lead.station
  const auditActions = (m.auditTrail ?? []).map(a => String(a.action ?? '').toLowerCase())
  const notes = (m.notes ?? []).map(n => String(n.content ?? '').toLowerCase()).join(' ')
  const agentNotes = (m.agentNotes ?? []).map(n => String(n.content ?? '').toLowerCase()).join(' ')
  const blob = `${notes} ${agentNotes}`
  const appt = m.pipeline?.appointment
  const disp = String(m.communications?.lastDisposition ?? '').toLowerCase()
  const motivation = m.situation?.motivation?.score
  const oppScore = m.scoring?.opportunity_score

  // Rule A: signed contract evidence
  const hasContractEvidence =
    !!m.closing?.tc_file_id
    || auditActions.some(a => a.includes('contract_signed') || a.includes('under_contract'))
    || /contract\s+signed|sent\s+for\s+sign|fully\s+executed/i.test(blob)
  if (hasContractEvidence && !TERMINAL.has(station)) {
    add(lead, m, 'under_contract', 'contract_evidence_present',
      [m.closing?.tc_file_id && 'tc_file_id', ...auditActions.filter(a => a.includes('contract'))].filter(Boolean).join('|'))
  }

  // Rule B: live appointment + early station
  if (appt && ['scheduled', 'confirmed', 'reconfirmed'].includes(appt.status) && EARLY.has(station)) {
    add(lead, m, 'appointment_set', 'live_appointment_but_early_station', `appt.status=${appt.status} scheduledAt=${appt.scheduledAt}`)
  }

  // Rule C: high opportunity score but early station
  if ((oppScore ?? 0) >= 75 && (motivation ?? 0) >= 60 && EARLY.has(station)) {
    add(lead, m, 'qualified', 'high_score_but_early_station', `opp=${oppScore} motivation=${motivation}`)
  }

  // Rule D: hard-no disposition but not terminal
  if (HARD_NO_DISPOS.has(disp) && !TERMINAL.has(station)) {
    add(lead, m, 'dead', 'hard_no_disposition', `lastDisposition=${disp}`)
  }

  // Rule E: offer made but early station
  if (m.financials?.offer_amount && !TERMINAL.has(station) && !['offer_made', 'offer', 'offer_prep', 'offer_presented', 'negotiating'].includes(station)) {
    add(lead, m, 'offer_made', 'offer_amount_set_but_no_offer_station', `offer_amount=${m.financials.offer_amount}`)
  }
}

// ─── Output ─────────────────────────────────────────────────────────────────

if (csvMode) {
  const header = 'lead_id,full_name,phone,current_station,suggested_station,reason,evidence'
  const csvEscape = v => /[,"\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')
  process.stdout.write(header + '\n')
  for (const f of findings) {
    process.stdout.write([f.lead_id, f.full_name, f.phone, f.current_station, f.suggested_station, f.reason, f.evidence].map(csvEscape).join(',') + '\n')
  }
} else {
  console.log(`\n=== Stuck Station Detector ===`)
  console.log(`Scanned: ${leads?.length ?? 0} leads`)
  console.log(`Findings: ${findings.length}\n`)
  const byReason = new Map()
  for (const f of findings) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1)
  const sorted = [...byReason.entries()].sort((a, b) => b[1] - a[1])
  console.log('By reason:')
  for (const [reason, n] of sorted) console.log(`  ${String(n).padStart(5)}  ${reason}`)

  console.log(`\nTop 15 sample:`)
  for (const f of findings.slice(0, 15)) {
    console.log(`  ${f.lead_id.slice(0, 8)} "${(f.full_name || '(no name)').padEnd(28)}" ${f.current_station} → ${f.suggested_station}  [${f.reason}]`)
  }
  console.log(`\nFor full CSV: node scripts/detect-stuck-stations.mjs --csv > stuck-stations.csv`)
}
