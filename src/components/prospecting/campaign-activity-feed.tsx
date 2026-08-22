'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { ProspectingCampaignActivity, ProspectingCampaignActivityPage } from '@/lib/prospecting/campaign-contract'

function eventPresentation(item: ProspectingCampaignActivity) {
  const normalized = item.eventType.replace(/^campaign_/, '')
  if (normalized === 'member_replied') return { icon: 'reply', label: 'Seller replied', tone: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' }
  if (normalized === 'member_suppressed') return { icon: 'block', label: 'Seller opted out', tone: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' }
  if (normalized.endsWith('_delivered')) return { icon: 'mark_chat_read', label: 'Carrier delivered', tone: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' }
  if (normalized.endsWith('_sent')) return { icon: 'send', label: 'Provider accepted', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' }
  if (normalized.endsWith('_blocked') || normalized.endsWith('_cancelled')) return { icon: 'block', label: item.errorCode === 'contact_replied' ? 'Stopped after reply' : 'Send blocked', tone: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' }
  if (normalized.endsWith('_failed')) return { icon: 'error', label: 'Delivery failed', tone: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' }
  if (normalized.includes('activated')) return { icon: 'play_arrow', label: 'Campaign activated', tone: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' }
  if (normalized.includes('paused')) return { icon: 'pause', label: 'Campaign paused', tone: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' }
  if (normalized.includes('archived')) return { icon: 'archive', label: 'Campaign archived', tone: 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]' }
  if (normalized.includes('created')) return { icon: 'add_circle', label: 'Campaign created', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' }
  if (normalized.includes('setup_updated')) return { icon: 'edit', label: 'Campaign setup updated', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' }
  if (normalized.includes('schedule_set') || normalized.includes('schedule_updated')) return { icon: 'schedule', label: 'Send schedule updated', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' }
  if (normalized.includes('enrolled')) return { icon: 'person_add', label: 'Audience enrolled', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' }
  if (normalized.includes('member_removed')) return { icon: 'person_remove', label: 'Contact removed', tone: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' }
  if (normalized.includes('dialer_batch_started')) return { icon: 'phone_in_talk', label: 'Calling batch started', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' }
  if (normalized.includes('member_call_completed')) return { icon: 'fact_check', label: 'Call outcome saved', tone: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' }
  return { icon: 'history', label: normalized.replaceAll('_', ' '), tone: 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]' }
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
    : 'Unknown time'
}

function reasonLabel(value: string) {
  return value.replaceAll('_', ' ')
}

export function CampaignActivityFeed({ campaignId }: { campaignId: string }) {
  const [items, setItems] = useState<ProspectingCampaignActivity[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (nextCursor?: string | null) => {
    const response = await fetch(`/api/prospecting/campaigns/${encodeURIComponent(campaignId)}/activity?limit=25${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ''}`, { cache: 'no-store' })
    const body = await response.json().catch(() => null) as (ProspectingCampaignActivityPage & { error?: string }) | null
    if (!response.ok || !body) throw new Error(body?.error || 'Campaign activity is unavailable')
    setItems((current) => nextCursor ? [...current, ...body.items.filter((item) => !current.some((existing) => existing.id === item.id))] : body.items)
    setCursor(body.pageInfo.nextCursor)
    setHasMore(body.pageInfo.hasMore)
  }, [campaignId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void load().catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'Campaign activity is unavailable')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [load])

  async function refresh() {
    setLoading(true)
    setError(null)
    try { await load() } catch (caught) { setError(caught instanceof Error ? caught.message : 'Campaign activity is unavailable') } finally { setLoading(false) }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try { await load(cursor) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Older activity is unavailable') } finally { setLoadingMore(false) }
  }

  return (
    <article className="crm-panel rounded-2xl p-5 sm:p-6" aria-label="Campaign operations feed">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="crm-eyebrow">Operations</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">What happened</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">A server-owned record of campaign controls, deliveries, blocks, and replies.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="crm-secondary-button inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black disabled:opacity-50"><Icon name="refresh" className={`text-base ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>

      {error ? <div role="alert" className="mt-4 rounded-xl border border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</div> : null}
      {loading && items.length === 0 ? <div className="mt-5 space-y-2" role="status" aria-label="Loading campaign activity">{[1, 2, 3].map((row) => <div key={row} className="h-16 animate-pulse rounded-xl bg-[var(--crm-surface-subtle)]" />)}</div> : null}
      {!loading && items.length === 0 && !error ? <div className="mt-5 rounded-2xl border border-dashed border-[var(--crm-border)] p-7 text-center"><Icon name="history" className="text-3xl text-[var(--crm-text-dim)]" /><p className="mt-2 text-sm font-black text-[var(--crm-ink)]">No activity yet</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Campaign controls and delivery results will appear here.</p></div> : null}

      {items.length ? <ol className="mt-5 space-y-2">{items.map((item) => {
        const presentation = eventPresentation(item)
        return <li key={item.id} className="flex gap-3 rounded-xl border border-[var(--crm-border)] p-3.5">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${presentation.tone}`}><Icon name={presentation.icon} className="text-lg" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"><div><p className="text-sm font-black capitalize text-[var(--crm-ink)]">{presentation.label}</p><p className="mt-0.5 text-[10px] font-bold text-[var(--crm-text-muted)]">{item.sellerName || item.phone || item.actor}</p></div><time className="text-[10px] font-bold text-[var(--crm-text-dim)]">{dateLabel(item.occurredAt)}</time></div>
            {item.propertyAddress ? <p className="mt-1 truncate text-[10px] text-[var(--crm-text-muted)]">{item.propertyAddress}</p> : null}
            {item.body ? <p className="mt-2 line-clamp-2 rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--crm-ink)]">{item.body}</p> : null}
            {item.errorCode ? <p className="mt-2 text-[10px] font-bold capitalize text-[var(--crm-warning)]">Reason: {reasonLabel(item.errorCode)}</p> : null}
            {item.leadId ? <Link href={`/conversations?lead=${encodeURIComponent(item.leadId)}`} className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-[var(--crm-brand)] hover:underline"><Icon name="forum" className="text-sm" />Open conversation</Link> : null}
          </div>
        </li>
      })}</ol> : null}

      {hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="crm-secondary-button mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-black disabled:opacity-50">{loadingMore ? <Icon name="progress_activity" className="animate-spin" /> : <Icon name="expand_more" />}Load older activity</button> : null}
    </article>
  )
}
