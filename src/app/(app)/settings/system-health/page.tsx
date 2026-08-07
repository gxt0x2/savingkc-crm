import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isCurrentUserAdmin } from '@/lib/auth/admin'
import { getSystemHygieneSnapshot } from '@/lib/system-hygiene/snapshot'
import { systemRegistry } from '@/lib/system-hygiene/registry'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null): string {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Chicago',
  }).format(new Date(value))
}

function StatusPill({ status }: { status: string }) {
  const className = status === 'healthy' || status === 'success' || status === 'active'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : status === 'deprecated' || status === 'blocked' || status === 'degraded'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : status === 'failed' || status === 'down'
        ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
        : 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]'

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${className}`}>
      {status}
    </span>
  )
}

export default async function SystemHealthPage() {
  if (!(await isCurrentUserAdmin())) redirect('/settings')
  const snapshot = await getSystemHygieneSnapshot()
  const activePolicies = snapshot.retention.policies.filter((policy) => policy.deletion_enabled).length
  const unhealthyWorkers = snapshot.workers.rows.filter((worker) => worker.status === 'down' || worker.status === 'degraded').length
  const latestRetentionRun = snapshot.retention.recentRuns[0]
  const latestCandidates = new Map(
    (latestRetentionRun?.summary ?? []).map((row) => [
      String(row.table_name),
      Number(row.candidate_count ?? row.deleted_count ?? 0),
    ]),
  )

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#d91f2b]">Administration</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-[var(--ck-text)]">System health & hygiene</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ck-text-muted)]">
            Real ownership, scheduled work, retention controls, and worker telemetry. No completion estimates or placeholder health scores.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings" className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-4 py-2 text-sm font-bold text-[var(--ck-text)] hover:border-[var(--ck-border-strong)]">
            Back to settings
          </Link>
          <Link href="/settings/system-health" className="rounded-xl bg-[#d91f2b] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#bd1722]">
            Refresh
          </Link>
        </div>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="System hygiene summary">
        {[
          ['Active systems', snapshot.registry.activeFeatures, `${snapshot.registry.deprecatedFeatures} deprecated`],
          ['Owned tables', snapshot.registry.registeredTables, 'Declared in registry'],
          ['Scheduled jobs', snapshot.registry.registeredCrons.length, 'Every cron has an owner'],
          ['Retention policies', snapshot.retention.policies.length, snapshot.retention.available ? `${activePolicies} allowed to delete` : 'Migration pending'],
          ['Worker warnings', snapshot.workers.available ? unhealthyWorkers : '—', snapshot.workers.available ? `${snapshot.workers.rows.length} monitored` : 'Telemetry unavailable'],
        ].map(([label, value, detail]) => (
          <article key={label} className="rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--ck-text-muted)]">{label}</p>
            <p className="mt-2 text-3xl font-black text-[var(--ck-text)]">{value}</p>
            <p className="mt-1 text-xs text-[var(--ck-text-dim)]">{detail}</p>
          </article>
        ))}
      </section>

      <section className="mb-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="overflow-hidden rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-sm">
          <div className="border-b border-[var(--ck-border)] px-5 py-4">
            <h2 className="text-base font-black text-[var(--ck-text)]">System ownership registry</h2>
            <p className="text-xs text-[var(--ck-text-muted)]">Every active or retiring surface has a business owner and declared dependencies.</p>
          </div>
          <div className="max-h-[540px] overflow-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 bg-[var(--ck-surface-elev)] text-[11px] uppercase tracking-wider text-[var(--ck-text-muted)]">
                <tr>
                  <th className="px-5 py-3">System</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Routes</th>
                  <th className="px-4 py-3">Tables</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ck-border)]">
                {systemRegistry.features.map((feature) => (
                  <tr key={feature.id} className="text-[var(--ck-text)]">
                    <td className="px-5 py-3 font-bold">{feature.name}</td>
                    <td className="px-4 py-3 text-[var(--ck-text-muted)]">{feature.owner}</td>
                    <td className="px-4 py-3"><StatusPill status={feature.status} /></td>
                    <td className="px-4 py-3 tabular-nums">{feature.routes.length + feature.apiRoutes.length}</td>
                    <td className="px-4 py-3 tabular-nums">{feature.tables.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="overflow-hidden rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-sm">
          <div className="border-b border-[var(--ck-border)] px-5 py-4">
            <h2 className="text-base font-black text-[var(--ck-text)]">Scheduled jobs</h2>
            <p className="text-xs text-[var(--ck-text-muted)]">The OpenAI Ads sync is retired; ARI and Google Ads remain active.</p>
          </div>
          <div className="divide-y divide-[var(--ck-border)]">
            {snapshot.registry.registeredCrons.map((cron) => (
              <div key={cron.path} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--ck-text)]">{cron.path}</p>
                  <p className="text-xs text-[var(--ck-text-muted)]">{cron.owner}</p>
                </div>
                <code className="shrink-0 rounded-lg bg-[var(--ck-surface-elev)] px-2 py-1 text-xs text-[var(--ck-text)]">{cron.schedule}</code>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-sm">
        <div className="flex flex-col gap-2 border-b border-[var(--ck-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-black text-[var(--ck-text)]">Data retention controls</h2>
            <p className="text-xs text-[var(--ck-text-muted)]">Daily monitoring is safe by default. Deletion requires a policy gate and the deployment kill switch.</p>
          </div>
          <StatusPill status={snapshot.retention.mutationsEnabled ? 'apply enabled' : 'dry run only'} />
        </div>
        {!snapshot.retention.available ? (
          <div className="m-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            {snapshot.retention.error ?? 'Retention controls are unavailable.'} The preview remains non-destructive until the migration is applied.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="bg-[var(--ck-surface-elev)] text-[11px] uppercase tracking-wider text-[var(--ck-text-muted)]">
                <tr>
                  <th className="px-5 py-3">Table</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Keep</th>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Candidates</th>
                  <th className="px-4 py-3">Archive</th>
                  <th className="px-4 py-3">Deletion</th>
                  <th className="px-4 py-3">Last preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ck-border)]">
                {snapshot.retention.policies.map((policy) => (
                  <tr key={policy.id} className="text-[var(--ck-text)]">
                    <td className="px-5 py-3 font-mono text-xs font-bold">{policy.table_name}</td>
                    <td className="px-4 py-3">{policy.owner}</td>
                    <td className="px-4 py-3 tabular-nums">{policy.retention_days} days</td>
                    <td className="px-4 py-3 tabular-nums">{policy.batch_size}</td>
                    <td className="px-4 py-3 tabular-nums">{latestCandidates.has(policy.table_name) ? latestCandidates.get(policy.table_name) : '—'}</td>
                    <td className="px-4 py-3">{policy.archive_required ? (policy.archive_verified_at ? 'Verified' : 'Required') : 'Not required'}</td>
                    <td className="px-4 py-3"><StatusPill status={policy.deletion_enabled ? 'enabled' : 'disabled'} /></td>
                    <td className="px-4 py-3 text-xs text-[var(--ck-text-muted)]">{formatDate(policy.last_preview_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {snapshot.retention.available && (
          <div className="flex flex-col gap-2 border-t border-[var(--ck-border)] px-5 py-4 text-xs text-[var(--ck-text-muted)] sm:flex-row sm:items-center sm:justify-between">
            {latestRetentionRun ? (
              <>
                <span>Latest run: {formatDate(latestRetentionRun.started_at)} · {latestRetentionRun.invoked_by}</span>
                <StatusPill status={latestRetentionRun.status} />
              </>
            ) : (
              <span>No retention runs recorded.</span>
            )}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-sm">
        <div className="border-b border-[var(--ck-border)] px-5 py-4">
          <h2 className="text-base font-black text-[var(--ck-text)]">Worker telemetry</h2>
          <p className="text-xs text-[var(--ck-text-muted)]">Current database-reported status, not a manufactured health percentage.</p>
        </div>
        {!snapshot.workers.available ? (
          <p className="p-5 text-sm text-[var(--ck-text-muted)]">{snapshot.workers.error}</p>
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {snapshot.workers.rows.map((worker) => (
              <article key={worker.name} className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black text-[var(--ck-text)]">{worker.name}</h3>
                    <p className="text-xs text-[var(--ck-text-muted)]">{worker.type} · every {worker.check_interval_minutes}m</p>
                  </div>
                  <StatusPill status={worker.status} />
                </div>
                <p className="mt-3 text-xs text-[var(--ck-text-muted)]">Last success: {formatDate(worker.last_success)}</p>
                {worker.last_error && <p className="mt-2 line-clamp-2 text-xs text-red-600 dark:text-red-300">{worker.last_error}</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="mt-4 text-right text-xs text-[var(--ck-text-dim)]">Generated {formatDate(snapshot.generatedAt)}</p>
    </main>
  )
}
