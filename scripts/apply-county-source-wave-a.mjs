#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'fprrknfyzlthbxewnwmi'
const EXPECTED_SOURCE_SHA256 = '9daa048b50f20244e79fa55ee51b12ae0d607c7cc7d5cf69386aafb7932418b4'
const EXPECTED_TOTAL = 2_183
const EXPECTED_RESIDENTIAL = 1_950
const EXPECTED_LAND = 233
const PAGE_SIZE = 1_000

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const sourcePath = join(repoRoot, 'docs', 'data', 'jackson-county-wave-a-fingerprints.json.gz')
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '20261010120000_county_source_reconciliation_audit.sql',
)

function parseEnvFile(path) {
  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function normalizeCounty(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+county$/, '')
}

function normalizeParcel(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '')
}

function normalizeAddress(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function fingerprint(kind, county, value) {
  const normalized = kind === 'parcel' ? normalizeParcel(value) : normalizeAddress(value)
  if (!normalized) return null
  const input = `${kind}|${normalizeCounty(county)}|${normalized}`
  return `${fnv1a64(`a|${input}`)}${fnv1a64(`b|${input}`)}`
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertSource(sourceText, sourceRows) {
  const sourceSha256 = sha256(sourceText)
  if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
    throw new Error(`Wave A source drift: expected ${EXPECTED_SOURCE_SHA256}, received ${sourceSha256}`)
  }
  if (!Array.isArray(sourceRows) || sourceRows.length !== EXPECTED_TOTAL) {
    throw new Error(`Wave A source row drift: expected ${EXPECTED_TOTAL}`)
  }

  const residential = sourceRows.filter((row) => row.propertyClass === 'residential').length
  const land = sourceRows.filter((row) => row.propertyClass === 'land').length
  const invalid = sourceRows.filter((row) =>
    normalizeCounty(row.county) !== 'jackson'
    || !['residential', 'land'].includes(row.propertyClass)
    || !['2 Yr. Only', '3 Yrs (+)', 'Land'].includes(row.sourceTab)
    || (!row.parcelKey && !row.addressKey),
  ).length

  if (residential !== EXPECTED_RESIDENTIAL || land !== EXPECTED_LAND || invalid !== 0) {
    throw new Error(
      `Wave A source composition drift: residential ${residential}, land ${land}, invalid ${invalid}`,
    )
  }
  return sourceSha256
}

async function readAllProspects(db) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from('prospects')
      .select('id,parcel_id,county,situs_address,situs_street,situs_city,situs_state,situs_zip,property_class')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`Production prospect read failed: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

export function buildWaveAPlan(sourceRows, prospects) {
  const byParcel = new Map()
  const byAddress = new Map()

  for (const prospect of prospects) {
    const county = normalizeCounty(prospect.county)
    if (county !== 'jackson') continue
    const address = prospect.situs_address || [
      prospect.situs_street,
      prospect.situs_city,
      prospect.situs_state,
      prospect.situs_zip,
    ].filter(Boolean).join(' ')
    const parcelKey = fingerprint('parcel', county, prospect.parcel_id)
    const addressKey = fingerprint('address', county, address)

    for (const [index, key] of [[byParcel, parcelKey], [byAddress, addressKey]]) {
      if (!key) continue
      const matches = index.get(key) || []
      matches.push(prospect)
      index.set(key, matches)
    }
  }

  const sourceIdentities = new Set()
  const prospectIds = new Set()
  const plan = []
  const state = { needsUpdate: 0, alreadyApplied: 0 }

  for (const source of sourceRows) {
    const sourceIdentity = source.parcelKey || source.addressKey
    if (sourceIdentities.has(sourceIdentity)) throw new Error('Wave A source contains a duplicate identity')
    sourceIdentities.add(sourceIdentity)

    const candidates = new Map()
    for (const candidate of source.parcelKey ? (byParcel.get(source.parcelKey) || []) : []) {
      candidates.set(candidate.id, candidate)
    }
    for (const candidate of source.addressKey ? (byAddress.get(source.addressKey) || []) : []) {
      candidates.set(candidate.id, candidate)
    }
    if (candidates.size !== 1) {
      throw new Error(`Wave A identity drift: source fingerprint matched ${candidates.size} prospects`)
    }

    const prospect = [...candidates.values()][0]
    if (prospectIds.has(prospect.id)) throw new Error('Wave A maps multiple source rows to one prospect')
    prospectIds.add(prospect.id)

    const currentClass = prospect.property_class || 'unknown'
    if (currentClass === 'unknown') state.needsUpdate += 1
    else if (currentClass === source.propertyClass) state.alreadyApplied += 1
    else throw new Error(`Wave A unexpected production property class on prospect ${prospect.id}`)

    plan.push({
      prospect_id: prospect.id,
      before_property_class: 'unknown',
      after_property_class: source.propertyClass,
      source_tab: source.sourceTab,
      parcel_fingerprint: source.parcelKey || null,
      address_fingerprint: source.addressKey || null,
    })
  }

  if (plan.length !== EXPECTED_TOTAL || prospectIds.size !== EXPECTED_TOTAL) {
    throw new Error(`Wave A match drift: expected ${EXPECTED_TOTAL} unique targets`)
  }
  if (!(
    (state.needsUpdate === EXPECTED_TOTAL && state.alreadyApplied === 0)
    || (state.needsUpdate === 0 && state.alreadyApplied === EXPECTED_TOTAL)
  )) {
    throw new Error(
      `Wave A partial state is not safe: ${state.needsUpdate} pending, ${state.alreadyApplied} already applied`,
    )
  }

  plan.sort((left, right) => left.prospect_id.localeCompare(right.prospect_id))
  return { plan, state, planSha256: sha256(JSON.stringify(plan)) }
}

function loadManagementToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const stored = execFileSync(
    'security',
    ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'],
    { encoding: 'utf8' },
  ).trim()
  if (stored.startsWith('go-keyring-base64:')) {
    return Buffer.from(stored.slice('go-keyring-base64:'.length), 'base64').toString('utf8')
  }
  return stored
}

async function managementQuery(query, { readOnly = false } = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loadManagementToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, read_only: readOnly }),
  })
  const body = await response.text()
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(body)
      message = parsed.message || parsed.error || message
    } catch {
      // Do not echo an unexpected response body from the control plane.
    }
    throw new Error(`Supabase management query failed: ${message}`)
  }
  return body ? JSON.parse(body) : []
}

function dollarQuotedJson(rows) {
  const serialized = JSON.stringify(rows)
  const delimiter = '$wave_a_rows$'
  if (serialized.includes(delimiter)) throw new Error('Wave A payload delimiter collision')
  return `${delimiter}${serialized}${delimiter}`
}

async function applyWaveA({ plan, sourceSha256, planSha256 }) {
  await managementQuery(readFileSync(migrationPath, 'utf8'))

  const batchId = randomUUID()
  const result = await managementQuery(`
    SELECT *
    FROM public.apply_jackson_county_wave_a_v1(
      '${batchId}'::uuid,
      '${sourceSha256}',
      '${planSha256}',
      ${dollarQuotedJson(plan)}::jsonb
    );
  `)
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('Wave A apply returned an unexpected result')
  }

  const verification = await managementQuery(`
    SELECT
      count(*)::integer AS audit_rows,
      count(DISTINCT audit.prospect_id)::integer AS distinct_prospects,
      count(*) FILTER (WHERE audit.after_property_class = 'residential')::integer AS residential,
      count(*) FILTER (WHERE audit.after_property_class = 'land')::integer AS land,
      count(*) FILTER (
        WHERE prospect.property_class IS DISTINCT FROM audit.after_property_class
      )::integer AS current_mismatches,
      count(DISTINCT audit.batch_id)::integer AS batches
    FROM public.county_source_reconciliation_audit AS audit
    JOIN public.prospects AS prospect ON prospect.id = audit.prospect_id
    WHERE audit.wave = 'jackson_property_class_wave_a'
      AND audit.source_sha256 = '${sourceSha256}'
      AND audit.plan_sha256 = '${planSha256}';
  `, { readOnly: true })

  const check = verification[0]
  if (!check
      || Number(check.audit_rows) !== EXPECTED_TOTAL
      || Number(check.distinct_prospects) !== EXPECTED_TOTAL
      || Number(check.residential) !== EXPECTED_RESIDENTIAL
      || Number(check.land) !== EXPECTED_LAND
      || Number(check.current_mismatches) !== 0
      || Number(check.batches) !== 1) {
    throw new Error('Wave A post-apply verification failed')
  }

  return {
    batchId: result[0].batch_id,
    updated: Number(result[0].updated_count),
    alreadyApplied: Boolean(result[0].already_applied),
    verification: {
      auditRows: Number(check.audit_rows),
      residential: Number(check.residential),
      land: Number(check.land),
      mismatches: Number(check.current_mismatches),
    },
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const apply = args.has('--apply')
  const confirmation = process.argv[process.argv.indexOf('--confirm-source-sha') + 1]
  if (apply && confirmation !== EXPECTED_SOURCE_SHA256) {
    throw new Error(`Apply requires --confirm-source-sha ${EXPECTED_SOURCE_SHA256}`)
  }

  const envPath = process.env.CRM_ENV_FILE || `${homedir()}/savingkc-crm/.env.local`
  const env = { ...parseEnvFile(envPath), ...process.env }
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Missing production Supabase configuration')

  const sourceText = gunzipSync(readFileSync(sourcePath)).toString('utf8')
  const sourceRows = JSON.parse(sourceText)
  const sourceSha256 = assertSource(sourceText, sourceRows)
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const prospects = await readAllProspects(db)
  const { plan, state, planSha256 } = buildWaveAPlan(sourceRows, prospects)

  const summary = {
    mode: apply ? 'apply' : 'preflight',
    sourceSha256,
    planSha256,
    targets: plan.length,
    residential: plan.filter((row) => row.after_property_class === 'residential').length,
    land: plan.filter((row) => row.after_property_class === 'land').length,
    state,
    writesAuthorized: apply,
  }

  if (!apply) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    return
  }

  const applied = await applyWaveA({ plan, sourceSha256, planSha256 })
  process.stdout.write(`${JSON.stringify({ ...summary, applied }, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
