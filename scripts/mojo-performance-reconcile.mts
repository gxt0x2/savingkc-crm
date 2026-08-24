#!/usr/bin/env node

import fs from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

import { fetchMojoPerformanceSnapshot, mojoPerformanceDatasetDigest } from './mojo-kpi-snapshot.mjs'
import { loadMojoEnv, mojoSessionFile } from './mojo-session-health.mjs'

loadMojoEnv()

const MAX_DAYS = 120

function cliValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function isoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} must use YYYY-MM-DD`)
  }
  return value
}

function centralToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${start}T12:00:00Z`)
  const final = new Date(`${end}T12:00:00Z`)
  while (cursor <= final) {
    dates.push(cursor.toISOString().slice(0, 10))
    if (dates.length > MAX_DAYS) throw new Error(`Date range exceeds the ${MAX_DAYS}-day safety cap`)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function sessionId(): string {
  const file = mojoSessionFile()
  if (!fs.existsSync(file)) throw new Error('Mojo session is missing; reauthenticate first')
  const session = JSON.parse(fs.readFileSync(file, 'utf8')) as { expired?: boolean; sessionId?: string }
  if (session.expired || !session.sessionId) throw new Error('Mojo session is expired; reauthenticate first')
  return session.sessionId
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('This command is dry-run only; production writes are intentionally disabled')
  const today = centralToday()
  const start = isoDate(cliValue('--start', today), '--start')
  const end = isoDate(cliValue('--end', today), '--end')
  if (start > end || end > today) throw new Error('Date range must end today or earlier and start before end')

  const dates = datesBetween(start, end)
  const mojoSessionId = sessionId()
  const fetchedAt = new Date().toISOString()
  const provider = []
  for (let offset = 0; offset < dates.length; offset += 4) {
    const rows = await Promise.all(dates.slice(offset, offset + 4).map((metricDate) => fetchMojoPerformanceSnapshot({
      sessionId: mojoSessionId,
      metricDate,
      fetchedAt,
    })))
    provider.push(...rows)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase admin configuration is unavailable')
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const [performanceResult, legacyResult] = await Promise.all([
    db.from('mojo_agent_daily_performance')
      .select('metric_date,dialing_seconds,calls,contacts,leads,appointments,source_digest,source_fetched_at')
      .eq('agent_key', 'casey').gte('metric_date', start).lte('metric_date', end).order('metric_date'),
    db.from('agent_daily_stats')
      .select('date,calls_made,meaningful_conversations,metadata')
      .eq('agent_id', 'casey').gte('date', start).lte('date', end).order('date'),
  ])
  const projectionAvailable = !performanceResult.error
  const existing = projectionAvailable ? performanceResult.data ?? [] : []
  const legacy = legacyResult.error ? [] : legacyResult.data ?? []
  const existingByDate = new Map(existing.map((row) => [String(row.metric_date), row]))
  const legacyByDate = new Map(legacy.map((row) => [String(row.date), row]))

  const reconciliation = provider.map((snapshot) => {
    const current = existingByDate.get(snapshot.metricDate)
    const legacyRow = legacyByDate.get(snapshot.metricDate)
    const matchesProjection = Boolean(current)
      && number(current?.calls) === snapshot.calls
      && number(current?.contacts) === snapshot.contacts
      && number(current?.dialing_seconds) === snapshot.dialingSeconds
      && String(current?.source_digest || '') === snapshot.sourceDigest
    return {
      metricDate: snapshot.metricDate,
      provider: {
        dialingSeconds: snapshot.dialingSeconds,
        calls: snapshot.calls,
        contacts: snapshot.contacts,
        leads: snapshot.leads,
        appointments: snapshot.appointments,
        sourceDigest: snapshot.sourceDigest,
      },
      projection: current || null,
      legacy: legacyRow ? {
        callsMade: number(legacyRow.calls_made),
        meaningfulConversations: number(legacyRow.meaningful_conversations),
      } : null,
      matchesProjection,
    }
  })
  const report = {
    dryRun: true,
    generatedAt: fetchedAt,
    range: { start, end, days: dates.length },
    datasetDigest: mojoPerformanceDatasetDigest(provider),
    projectionAvailable,
    projectionError: performanceResult.error?.message || null,
    legacyAvailable: !legacyResult.error,
    summary: {
      providerCalls: provider.reduce((sum, row) => sum + row.calls, 0),
      providerContacts: provider.reduce((sum, row) => sum + row.contacts, 0),
      providerDialingSeconds: provider.reduce((sum, row) => sum + row.dialingSeconds, 0),
      legacyCalls: legacy.reduce((sum, row) => sum + number(row.calls_made), 0),
      legacyMeaningfulConversations: legacy.reduce((sum, row) => sum + number(row.meaningful_conversations), 0),
      projectionMatches: reconciliation.filter((row) => row.matchesProjection).length,
      projectionDifferences: reconciliation.filter((row) => !row.matchesProjection).length,
    },
    reconciliation,
  }

  const defaultReport = path.join(homedir(), '.openclaw/workspace/memory/logs', `mojo-performance-reconciliation-${start}-to-${end}.json`)
  const reportPath = path.resolve(cliValue('--report', defaultReport))
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ ok: true, dryRun: true, reportPath, range: report.range, datasetDigest: report.datasetDigest, summary: report.summary }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[mojo-performance-reconcile] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
