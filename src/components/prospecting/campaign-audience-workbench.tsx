'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { CountyAudienceInventory } from '@/components/prospecting/county-audience-inventory'
import { CampaignSmsRecipientReview } from '@/components/prospecting/campaign-sms-recipient-review'
import { campaignAudienceContactsHref } from '@/lib/prospecting/audience-handoff'
import type { ProspectingCampaignMember, ProspectingCampaignMemberPage } from '@/lib/prospecting/campaign-contract'
import type { CampaignMemberFilter } from '@/lib/server/prospecting-campaign-members'

const FILTERS: Array<{ value: CampaignMemberFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'active', label: 'Ready' }, { value: 'needs_review', label: 'Needs review' }, { value: 'replied', label: 'Replied' },
  { value: 'suppressed', label: 'Suppressed' }, { value: 'completed', label: 'Completed' }, { value: 'removed', label: 'Removed' },
]

function memberTone(member: ProspectingCampaignMember) {
  if (member.status === 'active') return 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
  if (member.status === 'needs_review') return 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]'
  if (member.status === 'suppressed') return 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'
  return 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
}

export function CampaignAudienceWorkbench({ campaignId, campaignName, campaignKind, total, canEditAudience, onAudienceChanged }: { campaignId: string; campaignName: string; campaignKind?: 'dialer' | 'sms'; total: number; canEditAudience: boolean; onAudienceChanged?: () => void | Promise<void> }) {
  const [filter, setFilter] = useState<CampaignMemberFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [members, setMembers] = useState<ProspectingCampaignMember[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemovalId, setConfirmRemovalId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(searchQuery.trim().replace(/\s+/g, ' ').toLowerCase()), 300)
    return () => window.clearTimeout(timeout)
  }, [searchQuery])

  const load = useCallback(async (nextCursor?: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: '50', status: filter })
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (nextCursor) params.set('cursor', nextCursor)
    const url = `/api/prospecting/campaigns/${encodeURIComponent(campaignId)}/members?${params.toString()}`
    const response = await fetch(url, { cache: 'no-store', signal })
    const body = await response.json().catch(() => null) as (ProspectingCampaignMemberPage & { error?: string }) | null
    if (!response.ok || !body) throw new Error(body?.error || 'Campaign audience is unavailable')
    setMembers((current) => nextCursor ? [...current, ...body.items.filter((item) => !current.some((existing) => existing.id === item.id))] : body.items)
    setCursor(body.pageInfo.nextCursor)
    setHasMore(body.pageInfo.hasMore)
  }, [campaignId, debouncedSearch, filter])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setMembers([])
    setCursor(null)
    setHasMore(false)
    void load(null, controller.signal).catch((caught) => {
      if (!cancelled && (!(caught instanceof DOMException) || caught.name !== 'AbortError')) {
        setError(caught instanceof Error ? caught.message : 'Campaign audience is unavailable')
      }
    })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [load])

  const searchPending = searchQuery.trim().replace(/\s+/g, ' ').toLowerCase() !== debouncedSearch

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
    setConfirmRemovalId(null)
    setNotice(null)
    setFilter(nextFilter)
  }

  function changeSearch(nextQuery: string) {
    setSearchQuery(nextQuery)
    setMembers([])
    setCursor(null)
    setHasMore(false)
    setConfirmRemovalId(null)
    setNotice(null)
  }

  async function removeMember(member: ProspectingCampaignMember) {
    if (removingId) return
    setRemovingId(member.id)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/prospecting/campaigns/${encodeURIComponent(campaignId)}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: member.id }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || 'Contact could not be removed')
      setMembers((current) => current.filter((item) => item.id !== member.id))
      setConfirmRemovalId(null)
      setNotice(`${member.lead?.fullName || member.phone} was removed. No unsent campaign actions remain.`)
      await onAudienceChanged?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Contact could not be removed')
    } finally {
      setRemovingId(null)
    }
  }

  async function recipientReviewed(member: ProspectingCampaignMember, phone: string) {
    setMembers((current) => current.flatMap((item) => item.id !== member.id
      ? [item]
      : filter === 'needs_review'
        ? []
        : [{ ...item, phone, status: 'active' as const, suppressionReason: null }]))
    setNotice(`${member.lead?.fullName || phone} now has one reviewed SMS recipient. Nothing has been sent.`)
    await onAudienceChanged?.()
  }

  return <article className="crm-panel rounded-2xl p-5 sm:p-6" aria-label="Campaign audience workbench">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="crm-eyebrow">Full audience</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">Audience workbench</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Search all {total.toLocaleString()} contacts, then browse the matching results in bounded pages. Status filters also run on the server.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 text-base text-[var(--crm-text-dim)]" /><input value={searchQuery} onChange={(event) => changeSearch(event.target.value)} aria-label="Search entire campaign audience" placeholder="Name, address, or phone" maxLength={100} className="crm-field h-10 w-52 rounded-lg pl-9 pr-3 text-xs" /></label>{canEditAudience ? <Link href={campaignAudienceContactsHref(campaignId, campaignName)} className="crm-secondary-button inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-black"><Icon name="person_add" className="text-base" />Add contacts</Link> : <button type="button" disabled title="Pause this campaign before changing its audience" className="crm-secondary-button inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-black opacity-50"><Icon name="lock" className="text-base" />Audience locked</button>}</div></div>
    {canEditAudience ? <CountyAudienceInventory campaignId={campaignId} campaignKind={campaignKind} onEnrolled={onAudienceChanged} /> : null}
    <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Audience status filters">{FILTERS.map((option) => <button key={option.value} type="button" onClick={() => changeFilter(option.value)} className={`rounded-full px-3 py-1.5 text-[10px] font-black ${filter === option.value ? 'bg-[var(--crm-brand)] text-white' : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>{option.label}</button>)}</div>
    {error ? <div role="alert" className="mt-4 rounded-xl bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</div> : null}
    {notice ? <div role="status" className="mt-4 rounded-xl bg-[var(--crm-success-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-success)]">{notice}</div> : null}
    {(searchPending || (loading && members.length === 0)) ? <div role="status" className="mt-5 text-xs font-bold text-[var(--crm-text-muted)]">{searchQuery.trim() ? 'Searching the full campaign audience…' : 'Loading audience…'}</div> : null}
    {!searchPending && !loading && members.length === 0 && !error ? <div className="mt-5 rounded-xl border border-dashed border-[var(--crm-border)] p-6 text-center text-xs text-[var(--crm-text-muted)]">{debouncedSearch ? 'No campaign contacts match that search and status.' : 'No contacts match this status.'}</div> : null}
    {!searchPending && members.length ? <div className="mt-5 overflow-hidden rounded-xl border border-[var(--crm-border)]"><div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_6rem_7rem_10rem] gap-3 bg-[var(--crm-surface-subtle)] px-4 py-2 text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)] sm:grid"><span>Seller</span><span>Property</span><span>Phones</span><span>Status</span><span>Actions</span></div>{members.map((member) => <div key={member.id} className="grid gap-2 border-t border-[var(--crm-border)] px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_6rem_7rem_10rem] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-black text-[var(--crm-ink)]">{member.lead?.fullName || member.phone}</p><p className="text-[10px] text-[var(--crm-text-muted)]">{member.subjectKind === 'prospect' ? 'Source prospect' : 'CRM lead'} · {member.phone}</p></div><p className="truncate text-xs text-[var(--crm-text-muted)]">{member.lead?.propertyAddress || 'Property not recorded'}</p><p className="text-[10px] font-bold text-[var(--crm-text-muted)]">{member.readyContactCount} ready{member.suppressedContactCount ? ` · ${member.suppressedContactCount} blocked` : ''}</p><span className={`w-fit rounded-full px-2 py-1 text-[9px] font-black uppercase ${memberTone(member)}`}>{member.suppressionReason || member.status.replace('_', ' ')}</span><div className="flex flex-wrap items-center gap-1"><Link href={`/conversations?lead=${encodeURIComponent(member.leadId || `phone:${member.phone}`)}`} className="rounded-lg px-2 py-1.5 text-[9px] font-black text-[var(--crm-brand)] hover:bg-[var(--crm-brand-soft)]" aria-label={`Open conversation with ${member.lead?.fullName || member.phone}`}>Open inbox</Link>{campaignKind === 'sms' && canEditAudience && member.status !== 'removed' && member.status !== 'replied' && member.status !== 'suppressed' ? <CampaignSmsRecipientReview campaignId={campaignId} memberId={member.id} label={member.lead?.fullName || member.phone} onReviewed={(phone) => recipientReviewed(member, phone)} /> : null}{canEditAudience && member.status !== 'removed' ? confirmRemovalId === member.id ? <><button type="button" onClick={() => void removeMember(member)} disabled={Boolean(removingId)} className="rounded-lg bg-[var(--crm-danger)] px-2 py-1.5 text-[9px] font-black text-white disabled:opacity-50">{removingId === member.id ? 'Removing…' : 'Confirm'}</button><button type="button" onClick={() => setConfirmRemovalId(null)} disabled={Boolean(removingId)} className="rounded-lg bg-[var(--crm-surface-subtle)] px-2 py-1.5 text-[9px] font-black text-[var(--crm-text-muted)] disabled:opacity-50">Keep</button></> : <button type="button" onClick={() => setConfirmRemovalId(member.id)} className="rounded-lg px-2 py-1.5 text-[9px] font-black text-[var(--crm-danger)] hover:bg-[var(--crm-danger-soft)]" aria-label={`Remove ${member.lead?.fullName || member.phone} from campaign`}>Remove</button> : member.status === 'removed' ? <span className="text-[9px] font-bold text-[var(--crm-text-dim)]">History</span> : null}</div></div>)}</div> : null}
    {!searchPending && hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loading} className="crm-secondary-button mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-black disabled:opacity-50"><Icon name={loading ? 'progress_activity' : 'expand_more'} className={loading ? 'animate-spin' : ''} />Load 50 more</button> : null}
  </article>
}
