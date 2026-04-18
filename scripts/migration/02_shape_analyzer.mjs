#!/usr/bin/env node
// Phase 7 — Data shape analyzer. Probes every production manifest and
// reports what V2 fields exist with what frequency, so the transformToV2_1
// function can be designed against real data, not a spec's mental model.
// Read-only — this script makes no writes.
//
// Output: a markdown report at
//   docs/manifest-v2-1-spec/shape-analysis-2026-04.md

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync(process.env.HOME + '/savingkc-crm/.env.local', 'utf-8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const supabase = createClient(url, key, { auth: { persistSession: false } })

const { data: rows, error } = await supabase
  .from('manifests')
  .select('id, lead_id, manifest')
if (error) { console.error(error); process.exit(1) }

const N = rows.length

// Count how many manifests have each path populated (non-null, non-empty).
const pathCounts = new Map()
function recordPath(path, value) {
  if (value === null || value === undefined) return
  if (typeof value === 'string' && value === '') return
  if (Array.isArray(value) && value.length === 0) return
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return
  pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1)
}

function walk(obj, prefix = '') {
  if (obj === null || obj === undefined) return
  if (Array.isArray(obj)) return  // Don't descend into arrays (their structure is representative)
  if (typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    recordPath(path, v)
    walk(v, path)
  }
}

let selfNestedCount = 0
let embeddedTranscriptCount = 0
const versionCounts = new Map()
const stationCounts = new Map()
const priorityCounts = new Map()
const lifeEventCounts = new Map()

for (const row of rows) {
  const m = row.manifest ?? {}
  walk(m)

  if ('manifest' in m && typeof m.manifest === 'object') selfNestedCount++

  const transcripts = m.communications?.transcripts
  if (Array.isArray(transcripts) && transcripts.length > 0) embeddedTranscriptCount++

  const version = String(m.version ?? '(missing)')
  versionCounts.set(version, (versionCounts.get(version) ?? 0) + 1)
  const station = String(m.currentStation ?? '(missing)')
  stationCounts.set(station, (stationCounts.get(station) ?? 0) + 1)
  const priority = String(m.priority ?? '(missing)')
  priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + 1)
  const le = m.situation?.timeline?.lifeEventType ?? m.situation?.lifeEvent ?? null
  const leKey = String(le ?? '(missing/unset)')
  lifeEventCounts.set(leKey, (lifeEventCounts.get(leKey) ?? 0) + 1)
}

// Sort paths by frequency desc
const sortedPaths = [...pathCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([path, count]) => ({ path, count, pct: Math.round((count / N) * 100) }))

function formatCountTable(map) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| \`${k}\` | ${v} | ${Math.round((v / N) * 100)}% |`)
    .join('\n')
}

const report = `# Manifest V2 Shape Analysis — 2026-04-18

Probed all ${N} manifests in the \`manifests\` table to inform the Phase 7 \`transformToV2_1\` design. This is read-only analysis — no writes.

## Summary

- Total manifests: **${N}**
- Self-nested (\`manifest.manifest.*\`): **${selfNestedCount}** (${Math.round(selfNestedCount / N * 100)}%)
- With embedded transcripts: **${embeddedTranscriptCount}** (${Math.round(embeddedTranscriptCount / N * 100)}%)

## Version field distribution (inner \`manifest.version\`)

| Value | Count | Pct |
|---|---|---|
${formatCountTable(versionCounts)}

## \`currentStation\` distribution

| Value | Count | Pct |
|---|---|---|
${formatCountTable(stationCounts)}

## \`priority\` distribution

| Value | Count | Pct |
|---|---|---|
${formatCountTable(priorityCounts)}

## Life event type distribution

| Value | Count | Pct |
|---|---|---|
${formatCountTable(lifeEventCounts)}

## Every path populated, by frequency

Paths ordered by how many manifests have them populated (non-null, non-empty).
Paths with <5% population are candidates for "rarely set — transform can omit
and let downstream systems re-compute."

| Path | Count | Pct |
|---|---|---|
${sortedPaths.map(p => `| \`${p.path}\` | ${p.count} | ${p.pct}% |`).join('\n')}

---

## Transform design implications

**High-confidence mappings (populated in >50% of rows):**

${sortedPaths.filter(p => p.pct >= 50).map(p => `- \`${p.path}\` (${p.pct}%)`).join('\n')}

**Low-population paths (<5%) — transform can safely omit:**

${sortedPaths.filter(p => p.pct < 5 && p.pct > 0).slice(0, 30).map(p => `- \`${p.path}\` (${p.pct}%)`).join('\n')}

**Missing entirely (0% populated) — spec assumes these but reality doesn't have them:**

Any V2.1 field referenced in the spec that doesn't appear in the list above is either:
(a) not present in current V2 data — transform must synthesize or omit, or
(b) named differently in V2 — transform needs an explicit mapping rule.

---

Generated by \`scripts/migration/02_shape_analyzer.mjs\`.
`

mkdirSync('docs/manifest-v2-1-spec', { recursive: true })
writeFileSync('docs/manifest-v2-1-spec/shape-analysis-2026-04.md', report)
console.log(`Wrote docs/manifest-v2-1-spec/shape-analysis-2026-04.md (${report.length} bytes)`)
console.log(`${N} manifests analyzed, ${sortedPaths.length} distinct populated paths.`)
console.log(`Self-nested: ${selfNestedCount}, embedded transcripts: ${embeddedTranscriptCount}`)
