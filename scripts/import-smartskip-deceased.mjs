#!/usr/bin/env node
//
// Import a SmartSkip "deceased" CSV into the CRM as dialer-ready leads.
//
//   node scripts/import-smartskip-deceased.mjs <csv-path>            # dry run -> /tmp plan
//   node scripts/import-smartskip-deceased.mjs <csv-path> --apply    # write to Supabase
//
// Why this script exists: SmartSkip dumps up to 13 owner phones + 26 relatives
// (each with up to 5 phones) per lead. Importing that raw bogs the dialer with
// disconnected numbers, distant cousins, and reassigned lines. We score and
// keep only the top 5 phones per lead in `prospect_phones`; the full SmartSkip
// blob is archived to `prospects.raw_data` so a backup can be promoted later.
//
// Scoring tiers for deceased leads (calling heirs, not the deceased):
//   1. Primary's connected Mobile           (often surviving spouse on plan)
//   2. Child phones — Mobile then Residential, sweet-spot age first
//   3. Sibling / Spouse / Other heir Mobile + connected
//   4. Any other connected Residential
//   5. Last-resort connected number
// Skipped entirely: disconnected, OtherPhone (VoIP), Parents, distant relatives.

import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'

const csvPath = process.argv[2]
const apply = process.argv.includes('--apply')

if (!csvPath) {
  console.error('Usage: node scripts/import-smartskip-deceased.mjs <csv-path> [--apply]')
  process.exit(1)
}

const TOP_PHONES_PER_LEAD = 5
const COUNTY = 'johnson'
const DELINQUENT_CATEGORY = '3yr_plus'
const SOURCE_FILE = csvPath.split('/').pop()

const HEIR_TYPE_PRIORITY = {
  Child: 1,
  Sibling: 2,
  Spouse: 2,
  'In-law': 3,
  Parent: 4,
  Unknown: 5,
  'Other Relative': 5,
}

function normPhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

function normEmail(raw) {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  return /\S+@\S+\.\S+/.test(s) ? s : null
}

function syntheticParcelId(row) {
  // SmartSkip CSVs lack parcel_ids; prospects.parcel_id is NOT NULL with
  // UNIQUE(parcel_id, county). Hash the property address so re-imports of the
  // same property dedupe instead of duplicating.
  const key = [
    (row['Property Address'] || '').trim().toUpperCase(),
    (row['Property City'] || '').trim().toUpperCase(),
    (row['Property Zip'] || '').trim(),
  ].join('|')
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12)
  return `SS-DEC-${hash}`
}

function ageScore(age) {
  // Decision-making sweet spot for heirs (working-age children most likely to
  // answer mobile and have authority on the property): 30-65.
  const a = parseInt(age, 10)
  if (!Number.isFinite(a)) return 50
  if (a >= 30 && a <= 65) return 0
  if (a >= 25 && a <= 75) return 10
  return 25
}

function isCallable(phone) {
  if (phone.connected !== 'connected') return false
  if (phone.type === 'OtherPhone') return false // VoIP — usually junk
  return true
}

function buildCandidatePhones(row) {
  const phones = []

  // Primary owner phones (deceased — but spouse often still on the plan)
  for (let i = 1; i <= 13; i++) {
    const number = normPhone(row[`Phone ${i} number`])
    if (!number) continue
    phones.push({
      number,
      type: row[`Phone ${i} type`] || null,
      connected: row[`Phone ${i} connected`] || null,
      contact_name: `${row['First Name'] || ''} ${row['Last Name'] || ''}`.trim(),
      relationship: 'owner',
      heir_type: 'owner',
      heir_age_score: ageScore(row['Age']),
      contact_address: null,
    })
  }

  // Relative phones
  for (let r = 1; r <= 26; r++) {
    const fn = (row[`RELATIVE ${r}: First Name`] || '').trim()
    const ln = (row[`RELATIVE ${r}: Last Name`] || '').trim()
    if (!fn && !ln) continue
    const heirType = (row[`RELATIVE ${r}: Possible Type`] || 'Unknown').trim() || 'Unknown'
    const age = row[`RELATIVE ${r}: Age`]
    const street = row[`RELATIVE ${r}: Mailing Street`]
    const city = row[`RELATIVE ${r}: Mailing City`]
    const state = row[`RELATIVE ${r}: Mailing State`]
    const zip = row[`RELATIVE ${r}: Mailing ZIP Code`]
    const address = [street, city, state, zip].filter(Boolean).join(', ') || null

    for (let p = 1; p <= 5; p++) {
      const number = normPhone(row[`RELATIVE ${r}: Phone ${p} number`])
      if (!number) continue
      phones.push({
        number,
        type: row[`RELATIVE ${r}: Phone ${p} type`] || null,
        // SmartSkip relative phones don't carry a connected flag — assume
        // connected so they're not skipped outright. Twilio Lookup at dial
        // time is the real check.
        connected: 'connected',
        contact_name: `${fn} ${ln}`.trim(),
        relationship: heirType.toLowerCase(),
        heir_type: heirType,
        heir_age_score: ageScore(age),
        contact_address: address,
      })
    }
  }

  return phones
}

function scorePhone(p) {
  // Lower score = higher priority. Composed score so it's stable + explainable.
  let s = 0

  // Tier by relationship
  if (p.relationship === 'owner') {
    s += 0
  } else {
    s += (HEIR_TYPE_PRIORITY[p.heir_type] ?? 5) * 100
  }

  // Type: Mobile beats Residential beats unknown
  if (p.type === 'Mobile') s += 0
  else if (p.type === 'Residential') s += 30
  else s += 60

  // Connected status
  if (p.connected !== 'connected') s += 200

  // Age sweet-spot bonus (only meaningful for heirs)
  s += p.heir_age_score

  return s
}

function pickTopPhones(allPhones, n) {
  const callable = allPhones.filter(isCallable)
  callable.sort((a, b) => scorePhone(a) - scorePhone(b))

  // Dedup by phone number, keeping the highest-priority occurrence
  const seen = new Set()
  const out = []
  for (const p of callable) {
    if (seen.has(p.number)) continue
    seen.add(p.number)
    out.push(p)
    if (out.length >= n) break
  }
  return out
}

function buildLeadBundle(row) {
  const firstName = (row['First Name'] || '').trim()
  const lastName = (row['Last Name'] || '').trim()
  const middleName = (row['Middle Name'] || '').trim()
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ')
  if (!fullName) return null

  const propertyStreet = row['Property Address']?.trim() || null
  const propertyCity = row['Property City']?.trim() || null
  const propertyState = (row['Property State']?.trim() || 'KS') // SmartSkip leaves this blank for KS
  const propertyZip = row['Property Zip']?.trim() || null
  const fullPropertyAddress = [propertyStreet, propertyCity, propertyState, propertyZip].filter(Boolean).join(', ') || null

  const allPhones = buildCandidatePhones(row)
  const topPhones = pickTopPhones(allPhones, TOP_PHONES_PER_LEAD)

  if (topPhones.length === 0) {
    return { skip: true, reason: 'no callable phones', name: fullName }
  }

  // Top primary email (max 2 stored on prospects)
  const emails = []
  for (let i = 1; i <= 11; i++) {
    const e = normEmail(row[`Email ${i}`])
    if (e && !emails.includes(e)) emails.push(e)
    if (emails.length >= 2) break
  }

  return {
    skip: false,
    lead: {
      full_name: fullName,
      phone: topPhones[0].number,
      email: emails[0] || null,
      property_address: fullPropertyAddress,
      city: propertyCity,
      state: propertyState,
      zip: propertyZip,
      county: COUNTY,
      // leads.source has a CHECK constraint (manual / mojo_call / inbound_*).
      // Campaign provenance is preserved on prospects.source_file + source_sheet.
      source: 'manual',
    },
    prospect: {
      parcel_id: syntheticParcelId(row),
      county: COUNTY,
      situs_address: fullPropertyAddress,
      situs_street: propertyStreet,
      situs_city: propertyCity,
      situs_state: propertyState,
      situs_zip: propertyZip,
      owner_1: fullName,
      owner_1_first: firstName,
      owner_1_last: lastName,
      owner_1_type: 'Individual',
      mailing_street: row['Mailing Address']?.trim() || null,
      mailing_city: row['Mailing City']?.trim() || null,
      mailing_state: row['Mailing State']?.trim() || null,
      mailing_zip: row['Mailing Zip']?.trim() || null,
      delinquent_years_category: DELINQUENT_CATEGORY,
      is_deceased: true,
      is_skip_traced: true,
      owner_age: parseInt(row['Age'], 10) || null,
      email_1: emails[0] || null,
      email_2: emails[1] || null,
      // source_sheet / source_file / raw_data omitted: not present on prod
      // prospects schema. Backup phones live in the original CSV; promote a
      // raw_data column via migration if we want in-CRM archival later.
    },
    phones: topPhones.map((p) => ({
      phone: p.number,
      phone_type: p.type,
      phone_connected: p.connected,
      contact_name: p.contact_name,
      relationship: p.relationship,
      contact_address: p.contact_address,
      attempted: false,
    })),
    archived_phone_count: allPhones.length - topPhones.length,
  }
}

function loadEnv() {
  const envPath = `${process.env.HOME}/savingkc-crm/.env.local`
  const envContent = readFileSync(envPath, 'utf-8')
  const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim()
  const key = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim()
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }
  return createClient(url, key)
}

async function applyBundle(supabase, bundle) {
  // 1. Lead — upsert by (county, property_address) since SmartSkip CSV has no
  // stable lead ID. Insert if not found.
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id')
    .eq('property_address', bundle.lead.property_address)
    .eq('county', COUNTY)
    .maybeSingle()

  let leadId = existingLead?.id
  if (!leadId) {
    const { data: newLead, error: leadErr } = await supabase
      .from('leads')
      .insert(bundle.lead)
      .select('id')
      .single()
    if (leadErr) throw new Error(`leads insert: ${leadErr.message}`)
    leadId = newLead.id
  }

  // 2. Prospect — upsert by (parcel_id, county)
  const prospectRow = { ...bundle.prospect, lead_id: leadId }
  const { data: prospectUpsert, error: pErr } = await supabase
    .from('prospects')
    .upsert(prospectRow, { onConflict: 'parcel_id,county' })
    .select('id')
    .single()
  if (pErr) throw new Error(`prospects upsert: ${pErr.message}`)
  const prospectId = prospectUpsert.id

  // 3. Phones — clear any prior heir/owner rows for this prospect, then insert
  // top 5. We only nuke unattempted rows so call history isn't lost.
  await supabase
    .from('prospect_phones')
    .delete()
    .eq('prospect_id', prospectId)
    .eq('attempted', false)

  const phoneRows = bundle.phones.map((p) => ({ ...p, prospect_id: prospectId }))
  const { error: phErr } = await supabase.from('prospect_phones').insert(phoneRows)
  if (phErr) throw new Error(`prospect_phones insert: ${phErr.message}`)

  return { leadId, prospectId, phonesInserted: phoneRows.length }
}

async function main() {
  const csv = readFileSync(csvPath, 'utf-8')
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
  console.log(`Parsed ${rows.length} CSV rows from ${SOURCE_FILE}\n`)

  const bundles = []
  const skipped = []
  for (const row of rows) {
    const b = buildLeadBundle(row)
    if (!b) { skipped.push({ name: '(blank)', reason: 'no name' }); continue }
    if (b.skip) { skipped.push(b); continue }
    bundles.push(b)
  }

  const totalArchived = bundles.reduce((acc, b) => acc + b.archived_phone_count, 0)
  const totalDialQueue = bundles.reduce((acc, b) => acc + b.phones.length, 0)

  console.log(`Importable leads:    ${bundles.length}`)
  console.log(`Skipped:             ${skipped.length}`)
  console.log(`Top-tier phones:     ${totalDialQueue}  (avg ${(totalDialQueue / bundles.length).toFixed(1)} per lead)`)
  console.log(`Trimmed phones:      ${totalArchived}  (kept only in source CSV; restore via re-import if needed)\n`)

  if (skipped.length > 0) {
    console.log('Skipped leads:')
    skipped.forEach((s) => console.log(`  - ${s.name}: ${s.reason}`))
    console.log()
  }

  if (!apply) {
    const planPath = `/tmp/smartskip-deceased-plan-${Date.now()}.json`
    writeFileSync(planPath, JSON.stringify({ bundles, skipped }, null, 2))
    console.log(`Dry run — plan written to ${planPath}`)
    console.log('Re-run with --apply to write to Supabase.')
    return
  }

  const supabase = loadEnv()
  console.log('Applying to Supabase...\n')
  let ok = 0
  const failures = []
  for (const b of bundles) {
    try {
      const r = await applyBundle(supabase, b)
      ok++
      console.log(`✓ ${b.lead.full_name} -> lead=${r.leadId} prospect=${r.prospectId} phones=${r.phonesInserted}`)
    } catch (e) {
      failures.push({ name: b.lead.full_name, error: e.message })
      console.log(`✗ ${b.lead.full_name}: ${e.message}`)
    }
  }

  console.log(`\nDone: ${ok} succeeded, ${failures.length} failed`)
  if (failures.length > 0) console.log(JSON.stringify(failures, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
