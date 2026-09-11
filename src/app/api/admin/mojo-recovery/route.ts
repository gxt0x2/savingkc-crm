import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import expectedRuntime from '@/config/mojo-runtime-manifest.json'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getMojoHealth } from '@/lib/marketing/mojo-health'
import { mojoAlertDecision } from '@/lib/marketing/mojo-alert-policy'
import { mojoSchedule } from '@/lib/marketing/mojo-schedule.mjs'
import { recordMojoHealthIncident } from '@/lib/server/mojo-health-incident'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }
const Attempt = z.object({ exitCode: z.number().int().min(0).max(255), timedOut: z.boolean() }).strict()
const Schema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('start'), runId: z.string().uuid() }).strict(),
  z.object({ event: z.literal('attempt'), runId: z.string().uuid(), attempts: z.array(Attempt).min(1).max(3) }).strict(),
])

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized
  if (req.headers.get('x-mojo-runtime-digest') !== expectedRuntime.contentDigest) {
    return NextResponse.json({ ok: false, error: 'Mojo importer update required' }, { status: 409, headers })
  }
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid recovery receipt' }, { status: 400, headers })
  const body = parsed.data
  const db = supabaseAdmin()
  try {
    if (body.event === 'start') {
      const { error } = await db.from('mojo_recovery_runs').upsert({ id: body.runId, runtime_digest: expectedRuntime.contentDigest }, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
    const { data: run, error } = await db.from('mojo_recovery_runs').select('*').eq('id', body.runId).single()
    if (error || !run) throw new Error(error?.message || 'Recovery run missing')
    if (run.runtime_digest !== expectedRuntime.contentDigest) return NextResponse.json({ ok: false, error: 'Recovery runtime changed' }, { status: 409, headers })
    if (run.status !== 'running') {
      return NextResponse.json({ ok: true, run, health: await getMojoHealth(db) }, { headers })
    }
    if (body.event === 'start' || body.attempts.length <= run.attempt_count) {
      return NextResponse.json({ ok: true, run }, { headers })
    }
    const now = new Date()
    // A late child cannot turn an expired recovery run green.
    if (now.getTime() - Date.parse(run.started_at) > 20 * 60_000) return NextResponse.json({ ok: false, error: 'Recovery run expired' }, { status: 409, headers })
    const health = await getMojoHealth(db, { now })
    const alert = mojoAlertDecision(health)
    const last = body.attempts[body.attempts.length - 1]
    const intakeVerified = last.exitCode === 0 && health.lastSyncAt
      && Date.parse(health.lastSyncAt) >= Date.parse(run.started_at)
    const performanceVerified = health.performance.status === 'current'
      && health.performance.latestMetricDate === mojoSchedule(now).date
    const verified = Boolean(intakeVerified && performanceVerified && alert.kind !== 'operational_failure')
    const status = verified ? 'recovered' : body.attempts.length === 3 ? 'exhausted' : 'running'
    const failureKey = verified ? null : alert.failureKey || (!intakeVerified ? 'intake' : 'performance')
    const failureMessage = verified ? null : alert.kind === 'operational_failure' ? alert.message
      : !intakeVerified ? 'The current run has no verified source intake completion' : 'Current-day provider totals are not verified'
    const patch = { status, attempt_count: body.attempts.length, attempts: body.attempts,
      updated_at: now.toISOString(), completed_at: status === 'running' ? null : now.toISOString(),
      failure_key: failureKey, failure_message: failureMessage, last_sync_at: health.lastSyncAt,
      verification: { intakeVerified: Boolean(intakeVerified), performanceVerified, health: alert.kind,
        performanceFetchedAt: health.performance.latestFetchedAt, reconciliationCheckedAt: health.reconciliation.checkedAt } }
    const saved = await db.from('mojo_recovery_runs').update(patch).eq('id', body.runId).eq('status', 'running')
      .lt('attempt_count', body.attempts.length).select('*').maybeSingle()
    if (saved.error) throw new Error(saved.error.message)
    if (!saved.data) return NextResponse.json({ ok: false, error: 'Recovery receipt changed concurrently; retry' }, { status: 409, headers })
    // This still rechecks the same escalation gate; intermediate attempts never page.
    await recordMojoHealthIncident(db, { message: failureMessage || 'Recovery verified', reason: 'recovery_receipt', source: 'mojo-supervisor' }, now, health)
    return NextResponse.json({ ok: true, run: saved.data, health }, { headers })
  } catch (error) {
    console.error('[mojo-recovery]', error instanceof Error ? error.message : 'Receipt failed')
    return NextResponse.json({ ok: false, error: 'Recovery receipt could not be verified' }, { status: 503, headers })
  }
}
