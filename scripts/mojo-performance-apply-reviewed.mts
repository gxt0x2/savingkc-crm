#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

import {
  fetchMojoPerformanceSnapshot,
  mojoPerformanceDatasetDigest,
} from './mojo-kpi-snapshot.mjs'
import { loadMojoEnv, mojoSessionFile } from './mojo-session-health.mjs'
import type { MojoPerformanceSnapshot } from '../src/lib/server/mojo-performance'

loadMojoEnv()

type ReviewReport = {
  dryRun: boolean
  generatedAt: string
  datasetDigest: string
  range: { start: string; end: string; days: number }
  reconciliation: Array<{ metricDate: string }>
}

function cliValue(flag: string): string {
  const index = process.argv.indexOf(flag)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : ''
}

function sessionId(): string {
  const file = mojoSessionFile()
  if (!fs.existsSync(file)) throw new Error('Mojo session is missing; reauthenticate first')
  const session = JSON.parse(fs.readFileSync(file, 'utf8')) as { expired?: boolean; sessionId?: string }
  if (session.expired || !session.sessionId) throw new Error('Mojo session is expired; reauthenticate first')
  return session.sessionId
}

function readReport(reportPath: string): ReviewReport {
  if (!reportPath) throw new Error('--report is required')
  const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8')) as ReviewReport
  if (!report || typeof report !== 'object') throw new Error('Reviewed Mojo performance report is invalid')
  const expectedDates: string[] = []
  const cursor = new Date(`${report.range?.start || ''}T12:00:00Z`)
  const end = new Date(`${report.range?.end || ''}T12:00:00Z`)
  while (Number.isFinite(cursor.getTime()) && cursor <= end && expectedDates.length <= 120) {
    expectedDates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  const reportDates = Array.isArray(report.reconciliation)
    ? report.reconciliation.map((row) => row.metricDate)
    : []
  if (report.dryRun !== true
    || !/^\d{4}-\d{2}-\d{2}$/.test(report.range?.start || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(report.range?.end || '')
    || !Number.isInteger(report.range?.days)
    || report.range.days < 1
    || report.range.days > 120
    || !/^[a-f0-9]{64}$/.test(report.datasetDigest || '')
    || !Array.isArray(report.reconciliation)
    || report.reconciliation.length !== report.range.days
    || expectedDates.length !== report.range.days
    || JSON.stringify(reportDates) !== JSON.stringify(expectedDates)
  ) {
    throw new Error('Reviewed Mojo performance report is invalid')
  }
  return report
}

async function refetch(report: ReviewReport): Promise<MojoPerformanceSnapshot[]> {
  const id = sessionId()
  const fetchedAt = new Date().toISOString()
  const rows: MojoPerformanceSnapshot[] = []
  for (let offset = 0; offset < report.reconciliation.length; offset += 4) {
    const batch = await Promise.all(report.reconciliation.slice(offset, offset + 4).map((row) => fetchMojoPerformanceSnapshot({
      sessionId: id,
      metricDate: row.metricDate,
      fetchedAt,
    })))
    rows.push(...batch)
  }
  return rows
}

async function main() {
  if (!process.argv.includes('--apply')) throw new Error('No writes performed. Pass --apply only after the exact report digest is approved.')
  const report = readReport(cliValue('--report'))
  const approvedDigest = cliValue('--confirm-digest')
  if (!approvedDigest || approvedDigest !== report.datasetDigest) throw new Error('Approved dataset digest does not match the reviewed report')

  const snapshots = await refetch(report)
  const currentDigest = mojoPerformanceDatasetDigest(snapshots)
  if (currentDigest !== report.datasetDigest) throw new Error('Mojo performance dataset changed after review; generate a new dry run')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase admin configuration is unavailable')
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const preflight = await db.from('mojo_agent_daily_performance').select('metric_date').limit(1)
  if (preflight.error) throw new Error(`Mojo performance projection is unavailable: ${preflight.error.message}`)

  let applied = 0
  let retained = 0
  for (const snapshot of snapshots) {
    const { data, error } = await db.rpc('upsert_mojo_agent_daily_performance_v1', { p_snapshot: snapshot })
    if (error) throw new Error(`Mojo performance apply failed for ${snapshot.metricDate}: ${error.message}`)
    const result = data && typeof data === 'object' && !Array.isArray(data)
      ? data as { applied?: boolean }
      : null
    if (result?.applied) applied++
    else retained++
  }
  console.log(JSON.stringify({
    ok: true,
    applied,
    retained,
    range: report.range,
    datasetDigest: currentDigest,
  }, null, 2))
}

main().catch((error) => {
  console.error(`[mojo-performance-apply] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
