#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { MOJO_FIELD_OWNERSHIP_VERSION } from '../src/lib/server/mojo-field-ownership'
import { mapMojoDisposition, normalizeMojoCallRecord, type MojoCallRecord } from '../src/lib/server/mojo-call-import'
import { loadMojoEnv } from './mojo-session-health.mjs'
import { collectMojoBackfillCalls, mojoDatasetDigest } from './mojo-reconcile-backfill.mts'

loadMojoEnv()

type ReviewedReport = {
  dryRun: boolean
  generatedAt: string
  range: { start: string; end: string }
  bounds: { maxRecords: number; maxContacts: number }
  datasetDigest: string
  policyVersion: string
  eligibleRecordIds: string[]
  summary: {
    ambiguous: number
    protectedWrites: number
    matched: number
    governedCommandCandidates?: Record<string, number>
  }
}

function cliValue(flag: string): string {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] || '' : ''
}

function validateReport(value: unknown): ReviewedReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Reviewed report is invalid')
  const report = value as ReviewedReport
  const age = Date.now() - Date.parse(report.generatedAt)
  if (!report.dryRun || report.policyVersion !== MOJO_FIELD_OWNERSHIP_VERSION) throw new Error('Reviewed report uses the wrong ownership policy')
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) throw new Error('Reviewed report is older than 24 hours')
  if (report.summary.protectedWrites !== 0 || report.summary.ambiguous !== 0) throw new Error('Reviewed report did not pass safety reconciliation')
  if (!Array.isArray(report.eligibleRecordIds) || report.eligibleRecordIds.length !== report.summary.matched) throw new Error('Reviewed report candidate count is inconsistent')
  if (!report.range?.start || !report.range?.end || !report.datasetDigest) throw new Error('Reviewed report is incomplete')
  return report
}

async function requireOwnershipMigration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase admin configuration is unavailable')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.from('system_config').select('value').eq('key', 'mojo_field_ownership_version').maybeSingle()
  if (error) throw new Error(`Ownership migration check failed: ${error.message}`)
  const value = typeof data?.value === 'string' ? data.value : String(data?.value || '')
  if (value !== MOJO_FIELD_OWNERSHIP_VERSION) throw new Error('mojo_field_ownership_v1 is not active in production')
  return db
}

async function ingestEvidenceOnly(calls: MojoCallRecord[], db: Awaited<ReturnType<typeof requireOwnershipMigration>>) {
  const totals = { inserted: 0, replayed: 0, unresolved: 0 }
  for (const source of calls) {
    const call = normalizeMojoCallRecord(source)
    const { data, error } = await db.rpc('ingest_crm_mojo_call_v1', {
      p_call: call,
      p_outcome: mapMojoDisposition(call.disposition),
      p_call_at: call.call_date,
      p_follow_up_at: call.follow_up_date || null,
    })
    if (error) throw new Error(`Reviewed Mojo evidence ingestion failed: ${error.message}`)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Reviewed Mojo evidence ingestion returned invalid data')
    const result = data as Record<string, unknown>
    if (result.replayed === true) totals.replayed++
    else totals.inserted++
    if (typeof result.unresolvedReason === 'string' && result.unresolvedReason) totals.unresolved++
  }
  return totals
}

async function main() {
  if (!process.argv.includes('--apply-reviewed')) throw new Error('Missing --apply-reviewed safety acknowledgement')
  const reportPath = cliValue('--report')
  if (!reportPath) throw new Error('--report is required')
  const report = validateReport(JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8')))
  const db = await requireOwnershipMigration()
  const calls = await collectMojoBackfillCalls({
    start: report.range.start,
    end: report.range.end,
    maxRecords: report.bounds.maxRecords,
    maxContacts: report.bounds.maxContacts,
  })
  if (mojoDatasetDigest(calls) !== report.datasetDigest) throw new Error('Mojo dataset changed after review; generate a new dry run')
  const eligible = new Set(report.eligibleRecordIds)
  const reviewedCalls = calls.filter((call) => eligible.has(call.record_id))
  if (reviewedCalls.length !== eligible.size) throw new Error('Reviewed Mojo records are missing from the current dataset')
  const ingestion = await ingestEvidenceOnly(reviewedCalls, db)
  const governedCommandsSuppressed = Object.values(report.summary.governedCommandCandidates || {})
    .reduce((sum, count) => sum + Number(count || 0), 0)
  console.log(JSON.stringify({
    ok: true,
    mode: 'evidence_only',
    policyVersion: report.policyVersion,
    range: report.range,
    reviewed: reviewedCalls.length,
    governedCommandsSuppressed,
    ingestion,
  }, null, 2))
}

main().catch((error) => {
  console.error(`[mojo-apply] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
