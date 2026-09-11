#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadMojoEnv } from './mojo-session-health.mjs'

loadMojoEnv()

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`)
  return process.argv[index + 1]
}

async function main() {
  const reportPath = path.resolve(argument('--reviewed-report'))
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as {
    version?: string
    datasetDigest?: string
    repairableEventIds?: unknown
  }
  if (report.version !== 'mojo_source_projection_v2' || !Array.isArray(report.repairableEventIds)) {
    throw new Error('Reviewed report has an unsupported format')
  }
  const eventIds = report.repairableEventIds.filter((value): value is string => typeof value === 'string').sort()
  const digest = createHash('sha256').update(JSON.stringify(eventIds)).digest('hex')
  if (digest !== report.datasetDigest) throw new Error('Reviewed report digest does not match its repair set')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase admin configuration is unavailable')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const summary = { reviewed: eventIds.length, applied: 0, skippedAfterRecheck: 0, failed: 0 }
  for (const eventId of eventIds) {
    const { data: current, error: readError } = await db.from('crm_mojo_projection_repair_candidates_v2')
      .select('repair_class').eq('event_id', eventId).maybeSingle()
    if (readError) throw new Error(`Repair recheck failed for ${eventId}: ${readError.message}`)
    if (current?.repair_class !== 'repairable') {
      summary.skippedAfterRecheck++
      continue
    }
    const { error } = await db.rpc('repair_crm_mojo_event_projection_v2', { p_event_id: eventId })
    if (error) {
      summary.failed++
      console.error(`[mojo-projection-apply] ${eventId}: ${error.message}`)
    } else {
      summary.applied++
    }
  }
  console.log(JSON.stringify({ ok: summary.failed === 0, reportPath, datasetDigest: digest, summary }, null, 2))
  if (summary.failed) process.exit(1)
}

main().catch((error) => {
  console.error(`[mojo-projection-apply] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

