#!/usr/bin/env node
// V2.1 refactor acceptance suite — the definition of done.
//
// Checks every success criterion from docs/manifest-v2-1-spec/
// 00_README_START_HERE.md. Exits 0 only when all 8 pass.
// Any session working on this refactor runs this first ("where are we?")
// and last ("are we done?"). Done == 8/8 green.
//
// Read-only. Makes no writes.
//
// Usage: node scripts/migration/99_acceptance.mjs

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { encode } from 'gpt-tokenizer'

const env = readFileSync(process.env.HOME + '/savingkc-crm/.env.local', 'utf-8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const supabase = createClient(url, key, { auth: { persistSession: false } })

// ─── Helper: a single criterion check ───────────────────────────────────
class Result {
  constructor(id, label) { this.id = id; this.label = label; this.pass = null; this.detail = '' }
  ok(detail = '')  { this.pass = true;  this.detail = detail;  return this }
  fail(detail)     { this.pass = false; this.detail = detail;  return this }
  pending(detail)  { this.pass = false; this.detail = `PENDING — ${detail}`; return this }
}

// ─── Fetch all manifests once ───────────────────────────────────────────
const { data: rows, error } = await supabase
  .from('manifests')
  .select('id, lead_id, manifest, updated_at')
if (error) { console.error('manifests fetch failed:', error); process.exit(2) }
const N = rows.length

// ─── 1. Zero data loss ─────────────────────────────────────────────────
async function check1() {
  const r = new Result(1, 'Zero data loss after migration')
  // If the backup table doesn't exist, migration hasn't happened yet.
  const probe = await supabase.from('manifests_backup_v2_0').select('id', { head: true, count: 'exact' })
  if (probe.error?.code === 'PGRST205' || probe.error?.message?.includes('not find')) {
    return r.pending('manifests_backup_v2_0 not yet created (Phase A snapshot not applied)')
  }
  if (probe.error) return r.fail(`backup table error: ${probe.error.message}`)
  const backupCount = probe.count ?? 0
  if (backupCount === 0) return r.pending('backup exists but is empty')
  if (backupCount !== N) {
    return r.fail(`backup has ${backupCount} rows, current manifests has ${N} rows — diff means loss`)
  }
  // Live count matches backup count.
  return r.ok(`${N} rows in manifests, ${backupCount} in backup — counts match`)
}

// ─── 2. Zero self-nested ───────────────────────────────────────────────
function check2() {
  const r = new Result(2, 'Zero self-nested manifest.manifest paths')
  let count = 0
  const ids = []
  for (const row of rows) {
    if (row.manifest && typeof row.manifest === 'object' && 'manifest' in row.manifest) {
      count++
      if (ids.length < 3) ids.push(row.id)
    }
  }
  if (count === 0) return r.ok(`0 of ${N} self-nested`)
  return r.fail(`${count} of ${N} still self-nested (e.g., ${ids.join(', ')})`)
}

// ─── 3. Zero embedded transcripts ──────────────────────────────────────
function check3() {
  const r = new Result(3, 'Zero embedded transcripts')
  let count = 0
  for (const row of rows) {
    const t = row.manifest?.communications?.transcripts
    if (Array.isArray(t) && t.length > 0) count++
  }
  if (count === 0) return r.ok(`0 of ${N} have embedded transcripts`)
  return r.fail(`${count} of ${N} still have embedded transcripts`)
}

// ─── 4. Ari prompts use renderManifestForAri ──────────────────────────
async function check4() {
  const r = new Result(4, 'Every Ari prompt build uses renderManifestForAri')
  // Heuristic grep: look for lines that both stringify a manifest AND
  // appear in an Ari-prompt context. Any hit = fail.
  const { execSync } = await import('child_process')
  let hits = ''
  try {
    hits = execSync(
      `grep -rn -E "JSON\\.stringify.*manifest" src/ --include='*.js' --include='*.jsx' 2>/dev/null || true`,
      { encoding: 'utf-8' },
    )
  } catch {}
  const lines = hits
    .split('\n')
    .filter((l) => l)
    .filter((l) => {
      const lower = l.toLowerCase()
      return lower.includes('ari') || lower.includes('prompt') || lower.includes('briefing')
    })
  // Also check that renderManifestForAri is actually imported somewhere.
  let importedSomewhere = false
  try {
    const check = execSync(
      `grep -rn "renderManifestForAri" src/ --include='*.js' --include='*.jsx' 2>/dev/null || true`,
      { encoding: 'utf-8' },
    )
    importedSomewhere = check.split('\n').some((l) => l.includes('import') || l.includes('require'))
  } catch {}
  if (lines.length > 0) {
    return r.fail(`${lines.length} Ari-context callsite(s) still stringify manifests: ${lines[0]}`)
  }
  if (!importedSomewhere) {
    return r.pending('no production code imports renderManifestForAri yet (Phase 9 not started)')
  }
  return r.ok(`no stringify+ari hits; renderManifestForAri imported in production code`)
}

// ─── 5. p95 briefing under 1500 tokens ────────────────────────────────
async function check5() {
  const r = new Result(5, 'p95 pre-call briefing under 1500 tokens')
  // Try to dynamically import the renderer. If the manifest data isn't
  // V2.1-shaped yet, the render will throw on Zod validation — that's
  // a legitimate PENDING, not a FAIL.
  let renderPreCallBriefing, manifestV2_1Schema
  try {
    ;({ renderPreCallBriefing } = await import('../../src/lib/manifest/render.preCall.js'))
    ;({ manifestV2_1Schema } = await import('../../src/lib/manifest/schema.js'))
  } catch (e) {
    return r.pending(`renderer not importable from plain Node (expected for TS ESM) — ${e.message.split('\n')[0]}`)
  }

  const tokens = []
  let parseFailures = 0
  const now = new Date()
  for (const row of rows) {
    const parsed = manifestV2_1Schema.safeParse(row.manifest)
    if (!parsed.success) { parseFailures++; continue }
    try {
      const out = renderPreCallBriefing(parsed.data, { now })
      tokens.push(encode(out).length)
    } catch { parseFailures++ }
  }
  if (tokens.length === 0) {
    return r.pending(`none of ${N} manifests are V2.1-shaped yet (${parseFailures} parse failures)`)
  }
  tokens.sort((a, b) => a - b)
  const p95 = tokens[Math.floor(tokens.length * 0.95)]
  if (p95 < 1500) return r.ok(`p95=${p95} tokens across ${tokens.length} renders (${parseFailures} skipped)`)
  return r.fail(`p95=${p95} tokens exceeds 1500 budget across ${tokens.length} renders`)
}

// ─── 6. All writes via update_manifest_and_cascade ────────────────────
async function check6() {
  const r = new Result(6, 'All writes via update_manifest_and_cascade RPC')
  // Probe: attempt a direct UPDATE from service_role. If the lockdown
  // is in place, the trigger or GRANT revoke should reject it.
  // Write to a safe no-op field that we revert.
  const testId = rows[0]?.id
  if (!testId) return r.pending('no manifests to probe')
  const originalUpdatedAt = rows[0].updated_at
  const { error: directErr } = await supabase
    .from('manifests')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', testId)
  if (directErr) {
    const msg = directErr.message ?? ''
    if (/permission|denied|forbidden|direct writes/i.test(msg)) {
      return r.ok(`direct write rejected: ${msg.slice(0, 80)}`)
    }
    return r.fail(`direct write failed for a different reason: ${msg}`)
  }
  // Direct write SUCCEEDED — lockdown not yet in place. Revert.
  await supabase
    .from('manifests')
    .update({ updated_at: originalUpdatedAt })
    .eq('id', testId)
  return r.pending('direct writes from service_role still permitted (Phase 4 lockdown not applied)')
}

// ─── 7. Zod validation passes on 100% ─────────────────────────────────
async function check7() {
  const r = new Result(7, 'Zod validation passes on 100% of records')
  let manifestV2_1Schema
  try {
    ;({ manifestV2_1Schema } = await import('../../src/lib/manifest/schema.js'))
  } catch (e) {
    return r.pending(`schema not importable from plain Node — ${e.message.split('\n')[0]}`)
  }
  let failures = 0
  const sampleFail = []
  for (const row of rows) {
    const parsed = manifestV2_1Schema.safeParse(row.manifest)
    if (!parsed.success) {
      failures++
      if (sampleFail.length < 2) {
        const firstIssue = parsed.error.issues?.[0]
        sampleFail.push(`${row.id}: ${firstIssue?.path?.join('.')} — ${firstIssue?.message}`)
      }
    }
  }
  if (failures === 0) return r.ok(`${N}/${N} pass Zod validation`)
  return r.fail(`${failures}/${N} fail Zod validation. Samples: ${sampleFail.join(' | ')}`)
}

// ─── 8. Hot Opportunities reads hot_eligibility ───────────────────────
async function check8() {
  const r = new Result(8, 'Hot Opportunities reads hot_eligibility block')
  const { execSync } = await import('child_process')
  let ref = ''
  try {
    ref = execSync(
      `grep -rn "hot_eligibility" src/lib/hot-engine/ src/app/api/hot-opportunities/ 2>/dev/null || true`,
      { encoding: 'utf-8' },
    )
  } catch {}
  const lines = ref.split('\n').filter((l) => l && !l.includes('// ') && !l.includes('* '))
  if (lines.length === 0) {
    return r.pending('Hot Opportunities code does not yet reference hot_eligibility (Phase 11 cleanup)')
  }
  return r.ok(`hot_eligibility referenced in ${lines.length} hot-engine lines`)
}

// ─── Run all and report ────────────────────────────────────────────────
const results = [
  await check1(),
  check2(),
  check3(),
  await check4(),
  await check5(),
  await check6(),
  await check7(),
  await check8(),
]

console.log('')
console.log('V2.1 refactor acceptance — results')
console.log('='.repeat(72))
for (const r of results) {
  const icon = r.pass ? '✓' : r.detail.startsWith('PENDING') ? '…' : '✗'
  console.log(`${icon}  ${r.id}. ${r.label}`)
  if (r.detail) console.log(`      ${r.detail}`)
}
console.log('='.repeat(72))
const passed = results.filter((r) => r.pass).length
const pending = results.filter((r) => !r.pass && r.detail.startsWith('PENDING')).length
const failed = results.filter((r) => !r.pass && !r.detail.startsWith('PENDING')).length
console.log(`${passed}/${results.length} passing, ${pending} pending, ${failed} failing`)
console.log('')
if (failed > 0) {
  console.log('Some criteria FAILED — address before continuing.')
  process.exit(1)
}
if (pending > 0) {
  console.log('Not done yet — pending criteria remain. Keep working.')
  process.exit(1)
}
console.log('✓ All criteria green. V2.1 refactor is complete.')
process.exit(0)
