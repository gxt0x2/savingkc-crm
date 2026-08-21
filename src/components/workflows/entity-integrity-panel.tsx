'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { CrmEntityHealth } from '@/lib/server/crm-entity-foundation'
import type { CrmEntityConflictItem, CrmEntityConflictPage } from '@/lib/server/crm-entity-conflicts'

type LoadState = 'loading' | 'ready' | 'restricted' | 'error'

function conflictLabel(type: CrmEntityConflictItem['conflictType']): string {
  return type === 'phone_email_disagree'
    ? 'Phone and email point to different people'
    : 'Contact method is already linked elsewhere'
}

function formatDetectedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function EntityIntegrityPanel() {
  const [state, setState] = useState<LoadState>('loading')
  const [health, setHealth] = useState<CrmEntityHealth | null>(null)
  const [conflicts, setConflicts] = useState<CrmEntityConflictItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async (cursor?: string | null) => {
    const suffix = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20'
    const [healthResponse, conflictsResponse] = await Promise.all([
      fetch('/api/admin/entity-health', { cache: 'no-store' }),
      fetch(`/api/admin/entity-conflicts${suffix}`, { cache: 'no-store' }),
    ])
    if (healthResponse.status === 401 || conflictsResponse.status === 401) {
      return { restricted: true as const }
    }
    if (!healthResponse.ok && healthResponse.status !== 503) throw new Error('Entity health could not be loaded')
    if (!conflictsResponse.ok) throw new Error('Identity conflicts could not be loaded')
    return {
      restricted: false as const,
      health: await healthResponse.json() as CrmEntityHealth,
      page: await conflictsResponse.json() as CrmEntityConflictPage,
    }
  }, [])

  useEffect(() => {
    let active = true
    setState('loading')
    void load().then((result) => {
      if (!active) return
      if (result.restricted) {
        setState('restricted')
        return
      }
      setHealth(result.health)
      setConflicts(result.page.items)
      setNextCursor(result.page.pageInfo.nextCursor)
      setState('ready')
    }).catch(() => {
      if (active) setState('error')
    })
    return () => { active = false }
  }, [load])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await load(nextCursor)
      if (result.restricted) {
        setState('restricted')
        return
      }
      setHealth(result.health)
      setConflicts((current) => {
        const known = new Set(current.map((item) => item.id))
        return [...current, ...result.page.items.filter((item) => !known.has(item.id))]
      })
      setNextCursor(result.page.pageInfo.nextCursor)
    } catch {
      setState('error')
    } finally {
      setLoadingMore(false)
    }
  }

  if (state === 'loading') {
    return <section className="crm-panel rounded-2xl p-8 text-sm text-[var(--crm-text-muted)]" aria-busy="true">Loading canonical CRM integrity…</section>
  }

  if (state === 'restricted') {
    return (
      <section className="rounded-2xl border border-[var(--crm-warning)]/25 bg-[var(--crm-warning-soft)] p-6">
        <h2 className="font-black text-[var(--crm-ink)]">Administrator access required</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--crm-text-muted)]">Canonical identity health and conflict evidence are limited to administrators.</p>
      </section>
    )
  }

  if (state === 'error' || !health) {
    return (
      <section className="rounded-2xl border border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] p-6">
        <h2 className="font-black text-[var(--crm-ink)]">Entity integrity is unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--crm-text-muted)]">Coverage and identity conflicts could not be verified. No clean or zero state is being inferred.</p>
      </section>
    )
  }

  const coverage = Math.round(health.projectionCoverage * 1000) / 10
  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <HealthCard label="Projection coverage" value={health.available ? `${coverage}%` : 'Unavailable'} note={`${health.linkedLeads.toLocaleString()} of ${health.leads.toLocaleString()} compatibility leads`} icon="account_tree" tone="info" />
        <HealthCard label="People" value={health.people.toLocaleString()} note={`${health.contactMethods.toLocaleString()} normalized contact methods`} icon="person" tone="violet" />
        <HealthCard label="Properties" value={health.properties.toLocaleString()} note="Deduplicated postal identities" icon="home_work" tone="success" />
        <HealthCard label="Opportunities" value={health.opportunities.toLocaleString()} note="Linked acquisition opportunities" icon="trending_up" tone="warning" />
        <HealthCard label="Open conflicts" value={health.openIdentityConflicts.toLocaleString()} note={`${health.consentEvents.toLocaleString()} consent events preserved`} icon={health.openIdentityConflicts ? 'warning' : 'verified'} tone={health.openIdentityConflicts ? 'danger' : 'success'} />
      </section>

      {!health.available ? (
        <section className="rounded-2xl border border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] p-5 text-sm leading-6 text-[var(--crm-ink)]">
          The canonical projection is not available. Compatibility records remain active, and this page will not claim normalized coverage until the migration is present.
        </section>
      ) : null}

      <section className="crm-panel overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--crm-border)] p-5">
          <div>
            <p className="crm-eyebrow">Human review queue</p>
            <h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Identity conflicts</h2>
            <p className="mt-1 text-sm text-[var(--crm-text-muted)]">Evidence is visible, but this console does not merge or rewrite customer records.</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${health.openIdentityConflicts ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'}`}>
            {health.openIdentityConflicts ? `${health.openIdentityConflicts} ${health.openIdentityConflicts === 1 ? 'needs' : 'need'} review` : 'No open conflicts'}
          </span>
        </div>

        {conflicts.length === 0 ? (
          <div className="p-10 text-center">
            <Icon name="verified" className="text-[34px] text-[var(--crm-success)]" />
            <h3 className="mt-3 font-black text-[var(--crm-ink)]">Identity queue is clear</h3>
            <p className="mt-1 text-sm text-[var(--crm-text-muted)]">No ambiguous phone or email ownership is waiting for review.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--crm-border)]">
            {conflicts.map((conflict) => (
              <article key={conflict.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--crm-danger-soft)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--crm-danger)]">Review required</span>
                    {conflict.maskedValue ? <span className="font-mono text-xs text-[var(--crm-text-muted)]">{conflict.methodType} {conflict.maskedValue}</span> : null}
                  </div>
                  <h3 className="mt-2 font-black text-[var(--crm-ink)]">{conflictLabel(conflict.conflictType)}</h3>
                  <p className="mt-1 truncate text-sm text-[var(--crm-text-muted)]">{conflict.lead?.fullName || 'Unnamed contact'} · {conflict.lead?.propertyAddress || 'No property address'}</p>
                </div>
                <div className="text-sm">
                  <p><span className="text-[var(--crm-text-muted)]">Selected:</span> <strong className="text-[var(--crm-ink)]">{conflict.selectedPerson?.displayName || 'Missing person record'}</strong></p>
                  <p className="mt-1"><span className="text-[var(--crm-text-muted)]">Conflicts with:</span> <strong className="text-[var(--crm-ink)]">{conflict.conflictingPerson?.displayName || 'Existing method owner'}</strong></p>
                  <p className="mt-1 text-xs text-[var(--crm-text-dim)]">Detected {formatDetectedAt(conflict.detectedAt)}</p>
                </div>
                <Link href={`/leads/${conflict.leadId}`} className="crm-secondary-button inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-xs font-black">
                  Review lead <Icon name="open_in_new" className="text-[16px]" />
                </Link>
              </article>
            ))}
          </div>
        )}

        {nextCursor ? (
          <div className="border-t border-[var(--crm-border)] p-4 text-center">
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="crm-secondary-button h-10 rounded-lg px-5 text-xs font-black disabled:opacity-60">
              {loadingMore ? 'Loading…' : 'Load more conflicts'}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function HealthCard({ label, value, note, icon, tone }: {
  label: string
  value: string
  note: string
  icon: string
  tone: 'info' | 'violet' | 'success' | 'warning' | 'danger'
}) {
  const colors = {
    info: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
    violet: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]',
    success: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
    warning: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
    danger: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  }[tone]
  return (
    <article className="crm-panel rounded-2xl p-4">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${colors}`}><Icon name={icon} className="text-[19px]" /></span>
      <p className="mt-3 text-2xl font-black text-[var(--crm-ink)]">{value}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.11em] text-[var(--crm-text-muted)]">{label}</p>
      <p className="mt-2 text-xs leading-5 text-[var(--crm-text-muted)]">{note}</p>
    </article>
  )
}
