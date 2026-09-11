import { supabaseAdmin } from '@/lib/supabase/admin'
import { getMojoHealth } from '@/lib/marketing/mojo-health'
import { getMojoRecoverySnapshot } from '@/lib/server/mojo-health-incident'

function time(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'No receipt yet'
}

export async function MojoRecoveryStatus() {
  try {
    const db = supabaseAdmin()
    const health = await getMojoHealth(db)
    const { run, incident, decision } = await getMojoRecoverySnapshot(db, health)
    return <section id="mojo-recovery" className="mb-6 rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-5 shadow-sm" aria-label="Mojo automatic recovery">
      <h2 className="text-base font-black text-[var(--ck-text)]">Mojo automatic recovery</h2>
      <p className="mt-2 text-sm text-[var(--ck-text)]">{decision.message}</p>
      {decision.action && <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-300">{decision.action}</p>}
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-[var(--ck-text-muted)]">Last verified intake</dt><dd>{time(health.lastSyncAt)}</dd></div>
        <div><dt className="text-[var(--ck-text-muted)]">Latest recovery cycle</dt><dd>{run ? `${run.status} · ${run.attempt_count} of 3 attempts` : 'Awaiting collector receipt'}</dd></div>
        <div><dt className="text-[var(--ck-text-muted)]">Cycle updated</dt><dd>{time(run?.updated_at ?? null)}</dd></div>
      </dl>
      {run?.failure_message && <p className="mt-3 text-sm text-[var(--ck-text-muted)]">Last attempt: {run.failure_message}</p>}
      <p className="mt-3 text-xs text-[var(--ck-text-muted)]">Session renewal, retained-source replay, due queue retries and stale totals refresh run automatically. One escalation per unresolved incident after recovery fails or the collector misses its recovery deadline.</p>
      <p className="mt-2 text-xs text-[var(--ck-text-muted)]">{health.reconciliation.counts.evidencePendingAllAges} historical evidence holds remain separate from intake recovery.{incident?.alert_claimed_at ? ` Escalation recorded ${time(incident.alert_claimed_at)}; delivery ${incident.sms_status || 'unknown'}.` : ''}</p>
    </section>
  } catch {
    return <section id="mojo-recovery" className="mb-6 rounded-2xl border border-amber-500/30 p-5"><h2 className="font-bold">Mojo automatic recovery</h2><p className="mt-2 text-sm">Recovery verification is unavailable. Collector status is unknown until a receipt can be read.</p></section>
  }
}
