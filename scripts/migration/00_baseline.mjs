#!/usr/bin/env node
// Phase 0 baseline counts per docs/manifest-v2-1-spec/04_MIGRATION_PLAN.md.
//
// Note: spec refers to the payload column as `data`, actual column is `manifest`.
// Per doctrine rule 7, adopt the repo's name.

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync(process.env.HOME + '/savingkc-crm/.env.local', 'utf-8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const supabase = createClient(url, key, { auth: { persistSession: false } })

const PAGE = 1000
const rows = []
for (let offset = 0; ; offset += PAGE) {
  const { data, error } = await supabase
    .from('manifests')
    .select('id, version, manifest')
    .range(offset, offset + PAGE - 1)
  if (error) { console.error(error); process.exit(1) }
  if (!data?.length) break
  rows.push(...data)
  if (data.length < PAGE) break
}

const out = {
  total: rows.length,
  row_version_column: {},
  manifest_internal_version: {},
  self_nested: 0,
  embedded_audit_trail: 0,
  embedded_transcripts: 0,
  empty_arrays: 0,
  empty_objects: 0,
  size_buckets: { under_10kb: 0, '10_50kb': 0, over_50kb: 0 },
  max_size_bytes: 0,
  max_size_id: null,
}

function hasEmptyArrayOrObject(v, counters) {
  if (Array.isArray(v)) {
    if (v.length === 0) counters.empty_arrays++
    else for (const item of v) hasEmptyArrayOrObject(item, counters)
  } else if (v && typeof v === 'object') {
    if (Object.keys(v).length === 0) counters.empty_objects++
    else for (const k of Object.keys(v)) hasEmptyArrayOrObject(v[k], counters)
  }
}

for (const row of rows) {
  const m = row.manifest
  const rv = row.version ?? '(null)'
  out.row_version_column[rv] = (out.row_version_column[rv] ?? 0) + 1
  const iv = m?.version ?? '(missing)'
  out.manifest_internal_version[iv] = (out.manifest_internal_version[iv] ?? 0) + 1

  if (m && typeof m === 'object' && 'manifest' in m) out.self_nested++
  if (m?.auditTrail && Array.isArray(m.auditTrail) && m.auditTrail.length > 0) {
    out.embedded_audit_trail++
  }
  if (m?.communications?.transcripts && Array.isArray(m.communications.transcripts) && m.communications.transcripts.length > 0) {
    out.embedded_transcripts++
  }

  // Empty-collection counter (records the count of empties per row into totals)
  const counters = { empty_arrays: 0, empty_objects: 0 }
  hasEmptyArrayOrObject(m, counters)
  out.empty_arrays += counters.empty_arrays
  out.empty_objects += counters.empty_objects

  const size = JSON.stringify(m ?? {}).length
  if (size < 10000) out.size_buckets.under_10kb++
  else if (size < 50000) out.size_buckets['10_50kb']++
  else out.size_buckets.over_50kb++
  if (size > out.max_size_bytes) {
    out.max_size_bytes = size
    out.max_size_id = row.id
  }
}

console.log(JSON.stringify(out, null, 2))
