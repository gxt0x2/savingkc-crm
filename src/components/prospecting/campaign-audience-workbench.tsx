'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { ProspectingCampaignMember, ProspectingCampaignMemberPage } from '@/lib/prospecting/campaign-contract'
import type { CampaignMemberFilter } from '@/lib/server/prospecting-campaign-members'

const FILTERS: Array<{ value: CampaignMemberFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'active', label: 'Ready' }, { value: 'replied', label: 'Replied' },
  { value: 'suppressed', label: 'Suppressed' }, { value: 'completed', label: 'Completed' },
]

function dateLabel(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date) : '—'
}

function memberTone(member: ProspectingCampaignMember) {
  if (member.status === 'active') return 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
  if (member.status === 'suppressed') return 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'
  return 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
}

export function CampaignAudienceWorkbench({ campaignId, total }: { campaignId: string; total: number }) {
  const [filter, setFilter] = useState<CampaignMemberFilter>('all')
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<ProspectingCampaignMember[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (nextCursor?: string | null, signal?: AbortSignal) => {
    const url = `/api/prospecting/campaigns/${encodeURIComponent(campaignId)}/members?limit=50&status=${filter}${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ''}`
    const response = await fetch(url, { cache: 'no-store', signal })
    const body = await response.json().catch(() => null) as (ProspectingCampaignMemberPage & { error?: string }) | null
    if (!response.ok || !body) throw new Error(body?.error || 'Campaign audience is unavailable')
    setMembers((current) => nextCursor ? [...current, ...body.items.filter((item) => !current.some((existing) => existing.id === item.id))] : body.items)
    setCursor(body.pageInfo.nextCursor)
    setHasMore(body.pageInfo.hasMore)
  }, [campaignId, filter])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void load(null, controller.signal).catch((caught) => {
      if (!cancelled && (!(caught instanceof DOMException) || caught.name !== 'AbortError')) {
        setError(caught instanceof Error ? caught.message : 'Campaign audience is unavailable')
      }
    })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [load])

  const visibleMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return members
    return members.filter((member) => [member.lead?.fullName, member.lead?.propertyAddress, member.phone, member.suppressionReason]
      .some((value) => value?.toLowerCase().includes(normalized)))
  }, [members, query])

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    setError(null)
    try { await load(cursor) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Older audience rows are unavailable') } finally { setLoading(false) }
  }

  function changeFilter(nextFilter: CampaignMemberFilter) {
    if (nextFilter === filter) return
    setMembers([])
    setCursor(null)
    setHasMore(false)
    setQuery('')
    setFilter(nextFilter)
  }

  return <article className="crm-panel rounded-2xl p-5 sm:p-6" aria-label="Campaign audience workbench">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="crm-eyebrow">Full audience</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">Audience workbench</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Browse all {total.toLocaleString()} contacts in bounded pages. Status filters run on the server.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 text-base text-[var(--crm-text-dim)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find in loaded audience" placeholder="Find loaded contacts" className="crm-field h-10 w-48 rounded-lg pl-9 pr-3 text-xs" /></label><Link href="/contacts?list=prospects" className="crm-secondary-button inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-black"><Icon name="person_add" className="text-base" />Add contacts</Link></div></div>
    <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Audience status filters">{FILTERS.map((option) => <button key={option.value} type="button" onClick={() => changeFilter(option.value)} className={`rounded-full px-3 py-1.5 text-[10px] font-black ${filter === option.value ? 'bg-[var(--crm-brand)] text-white' : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>{option.label}</button>)}</div>
    {error ? <div role="alert" className="mt-4 rounded-xl bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</div> : null}
    {loading && members.length === 0 ? <div role="status" className="mt-5 text-xs font-bold text-[var(--crm-text-muted)]">Loading audience…</div> : null}
    {!loading && members.length === 0 && !error ? <div className="mt-5 rounded-xl border border-dashed border-[var(--crm-border)] p-6 text-center text-xs text-[var(--crm-text-muted)]">No contacts match this status.</div> : null}
    {!loading && members.length > 0 && visibleMembers.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-[var(--crm-border)] p-6 text-center text-xs text-[var(--crm-text-muted)]">No loaded contacts match that search. Load more contacts or clear the search.</div> : null}
    {visibleMembers.length ? <div className="mt-5 overflow-hidden rounded-xl border border-[var(--crm-border)]"><div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem_7rem] gap-3 bg-[var(--crm-surface-subtle)] px-4 py-2 text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)] sm:grid"><span>Seller</span><span>Property</span><span>Next</span><span>Status</span></div>{visibleMembers.map((member) => <div key={member.id} className="grid gap-2 border-t border-[var(--crm-border)] px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem_7rem] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-black text-[var(--crm-ink)]">{member.lead?.fullName || member.phone}</p><p className="text-[10px] text-[var(--crm-text-muted)]">{member.phone}</p></div><p className="truncate text-xs text-[var(--crm-text-muted)]">{member.lead?.propertyAddress || 'Property not recorded'}</p><p className="text-[10px] font-bold text-[var(--crm-text-muted)]">{dateLabel(member.nextActionAt)}</p><span className={`w-fit rounded-full px-2 py-1 text-[9px] font-black uppercase ${memberTone(member)}`}>{member.suppressionReason || member.status}</span></div>)}</div> : null}
    {hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loading} className="crm-secondary-button mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-black disabled:opacity-50"><Icon name={loading ? 'progress_activity' : 'expand_more'} className={loading ? 'animate-spin' : ''} />Load 50 more</button> : null}
  </article>
}
