#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadMojoEnv } from './mojo-session-health.mjs'

loadMojoEnv()

type Candidate = {
  event_id: string
  lead_id: string | null
  record_id: string
  call_at: string
  repair_class: 'repairable' | 'already_corrected' | 'conflicting' | 'ambiguous' | 'unavailable_source'
}

function outputPath(): string {
  const index = process.argv.indexOf('--report')
  const requested = index >= 0 ? process.argv[index + 1] : ''
  return path.resolve(requested || `reports/mojo-source-projection-audit-${new Date().toISOString().slice(0, 10)}.json`)
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('Audit is read-only; use mojo:projection:apply-reviewed with its report')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase admin configuration is unavailable')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const rows: Candidate[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('crm_mojo_projection_repair_candidates_v2')
      .select('event_id,lead_id,record_id,call_at,repair_class')
      .order('call_at', { ascending: true }).range(from, from + 999)
    if (error) throw new Error(`Projection audit failed: ${error.message}`)
    rows.push(...((data || []) as Candidate[]))
    if ((data || []).length < 1000) break
    if (rows.length >= 20_000) throw new Error('Projection audit exceeded the 20,000-row safety cap')
  }
  const counts = rows.reduce<Record<string, number>>((result, row) => {
    result[row.repair_class] = (result[row.repair_class] || 0) + 1
    return result
  }, {})
  const repairableEventIds = rows.filter((row) => row.repair_class === 'repairable').map((row) => row.event_id).sort()
  const datasetDigest = createHash('sha256').update(JSON.stringify(repairableEventIds)).digest('hex')
  const report = { version: 'mojo_source_projection_v2', dryRun: true, generatedAt: new Date().toISOString(), datasetDigest, counts, repairableEventIds }
  const reportPath = outputPath()
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ ok: true, reportPath, datasetDigest, counts }, null, 2))
}

main().catch((error) => {
  console.error(`[mojo-projection-audit] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

