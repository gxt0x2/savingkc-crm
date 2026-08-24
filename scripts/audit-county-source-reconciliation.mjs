#!/usr/bin/env node

// Read-only production snapshot for county-source reconciliation.
//
// The script intentionally emits fingerprints instead of names, addresses,
// parcel IDs, or phone numbers. A caller can compare the fingerprints with a
// normalized source export without copying production PII into an artifact.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createClient } from '@supabase/supabase-js'

const PAGE_SIZE = 1_000

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
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+county$/, '')
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

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 10) return `1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return digits
  return ''
}

function fingerprint(kind, county, value) {
  const normalized = kind === 'parcel'
    ? normalizeParcel(value)
    : kind === 'address'
      ? normalizeAddress(value)
      : normalizePhone(value)
  if (!normalized) return null
  const input = `${kind}|${normalizeCounty(county)}|${normalized}`
  return `${fnv1a64(`a|${input}`)}${fnv1a64(`b|${input}`)}`
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

async function readAll(db, table, columns) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

async function readStdinJson() {
  let body = ''
  for await (const chunk of process.stdin) {
    body += chunk
    const marker = body.indexOf('\n__COUNTY_SOURCE_END__\n')
    if (marker >= 0) {
      body = body.slice(0, marker)
      break
    }
  }
  const parsed = JSON.parse(body)
  if (!Array.isArray(parsed)) throw new Error('Source input must be a JSON array')
  return parsed
}

function keySet(values) {
  return new Set((values || []).filter(Boolean))
}

function compareSource(sourceRows, productionRows) {
  const byParcel = new Map()
  const byAddress = new Map()
  for (const row of productionRows) {
    if (row.parcelKey) {
      const list = byParcel.get(row.parcelKey) || []
      list.push(row)
      byParcel.set(row.parcelKey, list)
    }
    if (row.addressKey) {
      const list = byAddress.get(row.addressKey) || []
      list.push(row)
      byAddress.set(row.addressKey, list)
    }
  }

  const seenSource = new Set()
  const matchedProduction = new Set()
  const totals = {
    sourceRows: sourceRows.length,
    uniqueSourceRows: 0,
    exact: 0,
    needsUpdate: 0,
    new: 0,
    conflict: 0,
    sourceDuplicates: 0,
    unclassifiable: 0,
    missingPhoneLinks: 0,
    matchedProduction: 0,
    unmatchedProduction: 0,
  }
  const differences = {
    delinquency: 0,
    deceased: 0,
    propertyClass: 0,
    phones: 0,
  }
  const segments = {}
  const byCounty = {}
  const countyBucket = (county) => {
    const key = county || 'unknown'
    byCounty[key] ||= {
      sourceRows: 0,
      exact: 0,
      needsUpdate: 0,
      new: 0,
      conflict: 0,
      sourceDuplicates: 0,
      unclassifiable: 0,
      differences: {
        delinquency: 0,
        deceased: 0,
        propertyClass: 0,
        phones: 0,
        missingPhoneLinks: 0,
      },
    }
    return byCounty[key]
  }

  for (const source of sourceRows) {
    const countyTotals = countyBucket(source.county)
    countyTotals.sourceRows += 1
    const sourceIdentity = source.parcelKey || source.addressKey
    if (!sourceIdentity) {
      totals.conflict += 1
      countyTotals.conflict += 1
      continue
    }
    const sourceDedupeKey = `${source.county}|${sourceIdentity}`
    if (seenSource.has(sourceDedupeKey)) {
      totals.sourceDuplicates += 1
      countyTotals.sourceDuplicates += 1
      continue
    }
    seenSource.add(sourceDedupeKey)
    totals.uniqueSourceRows += 1

    const segmentKey = [
      source.county || 'unknown',
      source.delinquency || 'unclassified',
      source.deceased === null || source.deceased === undefined
        ? 'deceased_unknown'
        : source.deceased
          ? 'deceased'
          : 'non_deceased',
      source.propertyClass || 'unknown',
    ].join('|')
    segments[segmentKey] = (segments[segmentKey] || 0) + 1

    if (!source.delinquency || !['2yr', '3yr_plus'].includes(source.delinquency)) {
      totals.unclassifiable += 1
      countyTotals.unclassifiable += 1
    }

    const candidates = new Map()
    for (const candidate of source.parcelKey ? (byParcel.get(source.parcelKey) || []) : []) candidates.set(candidate.id, candidate)
    for (const candidate of source.addressKey ? (byAddress.get(source.addressKey) || []) : []) candidates.set(candidate.id, candidate)
    if (candidates.size === 0) {
      totals.new += 1
      countyTotals.new += 1
      continue
    }
    if (candidates.size > 1) {
      totals.conflict += 1
      countyTotals.conflict += 1
      continue
    }

    const production = [...candidates.values()][0]
    matchedProduction.add(production.id)
    let changed = false
    if (source.delinquency && source.delinquency !== production.delinquency) {
      differences.delinquency += 1
      countyTotals.differences.delinquency += 1
      changed = true
    }
    if (source.deceased !== null && source.deceased !== undefined && Boolean(source.deceased) !== Boolean(production.deceased)) {
      differences.deceased += 1
      countyTotals.differences.deceased += 1
      changed = true
    }
    if (source.propertyClass && source.propertyClass !== 'unknown' && source.propertyClass !== production.propertyClass) {
      differences.propertyClass += 1
      countyTotals.differences.propertyClass += 1
      changed = true
    }

    const productionPhones = keySet(production.phones.map((phone) => phone.key))
    const missingPhones = [...keySet(source.phones)].filter((phone) => !productionPhones.has(phone)).length
    if (missingPhones > 0) {
      differences.phones += 1
      countyTotals.differences.phones += 1
      totals.missingPhoneLinks += missingPhones
      countyTotals.differences.missingPhoneLinks += missingPhones
      changed = true
    }

    if (changed) {
      totals.needsUpdate += 1
      countyTotals.needsUpdate += 1
    } else {
      totals.exact += 1
      countyTotals.exact += 1
    }
  }

  totals.matchedProduction = matchedProduction.size
  const targetCounties = new Set(sourceRows.map((row) => row.county).filter(Boolean))
  const targetProduction = productionRows.filter((row) => targetCounties.has(row.county))
  totals.unmatchedProduction = targetProduction.filter((row) => !matchedProduction.has(row.id)).length

  return { totals, differences, byCounty, segments }
}

async function main() {
  const envPath = process.env.CRM_ENV_FILE || `${homedir()}/savingkc-crm/.env.local`
  const env = { ...parseEnvFile(envPath), ...process.env }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing production Supabase configuration')

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const [prospects, phones] = await Promise.all([
    readAll(
      db,
      'prospects',
      'id,parcel_id,county,situs_address,situs_street,situs_city,situs_state,situs_zip,delinquent_years_category,is_deceased,property_class,lead_id',
    ),
    readAll(
      db,
      'prospect_phones',
      'id,prospect_id,phone,phone_connected,last_disposition',
    ),
  ])

  const phoneRows = new Map()
  for (const phone of phones) {
    const prospectId = String(phone.prospect_id || '')
    if (!prospectId) continue
    const list = phoneRows.get(prospectId) || []
    const keyValue = fingerprint('phone', '', phone.phone)
    if (keyValue) {
      list.push({
        key: keyValue,
        connected: String(phone.phone_connected || '').trim().toLowerCase(),
        disposition: String(phone.last_disposition || '').trim().toLowerCase(),
      })
    }
    phoneRows.set(prospectId, list)
  }

  const output = prospects.map((prospect) => {
    const county = normalizeCounty(prospect.county)
    const address = prospect.situs_address || [
      prospect.situs_street,
      prospect.situs_city,
      prospect.situs_state,
      prospect.situs_zip,
    ].filter(Boolean).join(' ')
    return {
      id: prospect.id,
      county,
      parcelKey: fingerprint('parcel', county, prospect.parcel_id),
      addressKey: fingerprint('address', county, address),
      delinquency: prospect.delinquent_years_category || null,
      deceased: prospect.is_deceased === true,
      propertyClass: prospect.property_class || 'unknown',
      linkedLead: Boolean(prospect.lead_id),
      phones: phoneRows.get(String(prospect.id)) || [],
    }
  })

  const snapshot = {
    generatedAt: new Date().toISOString(),
    prospects: output,
    totals: {
      prospects: output.length,
      phones: output.reduce((sum, prospect) => sum + prospect.phones.length, 0),
    },
  }

  if (process.argv.includes('--source-stdin')) {
    const sourceRows = await readStdinJson()
    process.stdout.write(JSON.stringify({
      generatedAt: snapshot.generatedAt,
      productionTotals: snapshot.totals,
      reconciliation: compareSource(sourceRows, output),
    }))
    return
  }

  process.stdout.write(JSON.stringify(snapshot))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
