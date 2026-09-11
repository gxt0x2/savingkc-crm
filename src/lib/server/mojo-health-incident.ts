import 'server-only'
import type { supabaseAdmin } from '@/lib/supabase/admin'
import expectedRuntime from '@/config/mojo-runtime-manifest.json'
import { getMojoHealth, type MojoHealth } from '@/lib/marketing/mojo-health'
import { mojoAlertDecision } from '@/lib/marketing/mojo-alert-policy'
import { mojoRecoveryDecision, type MojoRecoveryRun, type MojoRecoveryIncident } from '@/lib/marketing/mojo-recovery-policy'
import { sendMojoIngestionFailureSmsAlert } from '@/lib/server/operational-sms-alerts'

type SupabaseLike = Pick<ReturnType<typeof supabaseAdmin>, 'from' | 'rpc'>
export type MojoIncidentInput = {
  message: string; reason: string; source: string
  sessionStatus?: string | null; syncHealth?: string | null; lastSyncAt?: string | null
}
export type MojoIncidentResult = { created: boolean; alerted: boolean }

export async function getMojoRecoverySnapshot(db: SupabaseLike, health: MojoHealth, now = new Date()) {
  const [runs, incidents] = await Promise.all([
    db.from('mojo_recovery_runs').select('*').order('started_at', { ascending: false }).limit(1),
    db.from('mojo_recovery_incidents').select('*').eq('status', 'open').limit(1),
  ])
  if (runs.error || incidents.error) throw new Error(`Mojo recovery ledger unavailable: ${runs.error?.message || incidents.error?.message}`)
  const run = (runs.data?.[0] ?? null) as MojoRecoveryRun | null
  const incident = (incidents.data?.[0] ?? null) as MojoRecoveryIncident | null
  const alert = mojoAlertDecision(health)
  return { run, incident, alert, decision: mojoRecoveryDecision(alert, run, incident, expectedRuntime.contentDigest, now) }
}

/** Every failure producer goes through fresh verification and the same durable episode. */
export async function recordMojoHealthIncident(db: SupabaseLike, input: MojoIncidentInput,
  now = new Date(), verifiedHealth?: MojoHealth): Promise<MojoIncidentResult> {
  const health = verifiedHealth ?? await getMojoHealth(db, { now })
  let snapshot = await getMojoRecoverySnapshot(db, health, now)
  const { alert } = snapshot
  if (alert.kind !== 'operational_failure') {
    if (snapshot.incident) {
      const { error } = await db.from('mojo_recovery_incidents').update({ status: 'resolved', resolved_at: now.toISOString(), last_seen_at: now.toISOString() })
        .eq('id', snapshot.incident.id).eq('status', 'open')
      if (error) throw new Error(`Mojo recovery closure failed: ${error.message}`)
    }
    return { created: false, alerted: false }
  }
  if (!snapshot.incident) {
    const { error } = await db.from('mojo_recovery_incidents').insert({
      failure_key: alert.failureKey, failure_message: alert.message,
      first_seen_at: now.toISOString(), last_seen_at: now.toISOString(),
    })
    if (error && error.code !== '23505') throw new Error(`Mojo recovery observation failed: ${error.message}`)
    snapshot = await getMojoRecoverySnapshot(db, health, now)
  }
  const incident = snapshot.incident
  if (!incident) throw new Error('Mojo recovery incident was not retained')
  const { error: updateError } = await db.from('mojo_recovery_incidents').update({
    last_seen_at: now.toISOString(), failure_key: alert.failureKey, failure_message: alert.message,
    recovery_run_id: snapshot.run?.id ?? null,
  }).eq('id', incident.id).eq('status', 'open')
  if (updateError) throw new Error(`Mojo recovery observation update failed: ${updateError.message}`)
  if (!snapshot.decision.escalate) return { created: false, alerted: false }

  // A database compare-and-set gives all producers one escalation per unresolved episode.
  const { data: claim, error: claimError } = await db.from('mojo_recovery_incidents')
    .update({ alert_claimed_at: now.toISOString(), sms_status: 'claimed' })
    .eq('id', incident.id).eq('status', 'open').is('alert_claimed_at', null).select('id').maybeSingle()
  if (claimError) throw new Error(`Mojo escalation claim failed: ${claimError.message}`)
  if (!claim) return { created: false, alerted: false }
  const message = `${snapshot.decision.message} ${snapshot.decision.action}`
  const event = {
    event_type: 'system_failure', priority: 'critical', title: 'System failure: Mojo ingestion',
    description: message, read: false, dismissed: false,
    metadata: { system: 'mojo_ingestion', incident_id: incident.id, reason: alert.failureKey,
      source: input.source, recovery_run_id: snapshot.run?.id ?? null },
  }
  let { error: insertError } = await db.from('ari_briefing_events').insert(event)
  if (insertError && /ari_briefing_events\.metadata|metadata.*column|column.*metadata/i.test(insertError.message)) {
    const { metadata: _metadata, ...legacy } = event
    ;({ error: insertError } = await db.from('ari_briefing_events').insert(legacy))
  }
  if (insertError) {
    await db.from('mojo_recovery_incidents').update({ alert_claimed_at: null, sms_status: 'failed' }).eq('id', incident.id)
    throw new Error(`Mojo incident insert failed: ${insertError.message}`)
  }
  try {
    const result = await sendMojoIngestionFailureSmsAlert({ incidentId: incident.id, message, source: input.source })
    const sent = Boolean(result.result?.success)
    // Never resend an ambiguous delivery. The durable incident stays visible for technical review.
    await db.from('mojo_recovery_incidents').update({ sms_status: sent ? 'sent' : 'failed' }).eq('id', incident.id)
    return { created: true, alerted: sent }
  } catch (error) {
    await db.from('mojo_recovery_incidents').update({ sms_status: 'unknown' }).eq('id', incident.id)
    throw error
  }
}
