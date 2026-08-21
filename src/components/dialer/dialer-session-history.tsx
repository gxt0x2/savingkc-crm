'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { formatPhone, toProperCase } from '@/lib/format'
import {
  loadDialerAttemptHistory,
  loadDialerSessionHistory,
  decideDialerAiChanges,
  type DialerHistoryPage,
  type DurableDialerAttempt,
  type DurableDialerSession,
} from '@/lib/dialer-session-client'
import type { AiChangeProposal } from '@/lib/ai-change-proposal'
import { AiChangeProposalCard } from '@/components/ai/ai-change-proposal-card'

interface DialerSessionHistoryProps {
  onResume: (session: DurableDialerSession) => void
  onOpenQueue: () => void
}

function label(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function dateTime(value: string | null) {
  if (!value) return 'In progress'
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function duration(seconds: number | null) {
  if (seconds == null) return '—'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function statusTone(status: DurableDialerSession['status']) {
  if (status === 'active') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'paused') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
  if (status === 'completed') return 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
  return 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'
}

function AiChangeReview({
  proposal,
  sessionId,
  clientAttemptId,
  onChange,
}: {
  proposal: AiChangeProposal
  sessionId: string
  clientAttemptId: string
  onChange: (proposal: AiChangeProposal) => void
}) {
  async function decide(decision: 'approved' | 'rejected') {
    const next = await decideDialerAiChanges({
      sessionId,
      clientAttemptId,
      decision,
      decisionKey: `dialer-ai:${proposal.id}:${decision}`,
    })
    if (!next) throw new Error('Could not save the AI change decision.')
    onChange(next)
    return next
  }

  return <div className="mt-3"><AiChangeProposalCard proposal={proposal} onDecision={decide} /></div>
}

function PostCallReview({ attempt, sessionId, onProposalChange }: { attempt: DurableDialerAttempt; sessionId: string; onProposalChange: (proposal: AiChangeProposal) => void }) {
  const review = attempt.postCallReview
  if (!review || review.status === 'not_requested' || review.status === 'skipped') return null
  if (review.status === 'processing') {
    return <p className="mt-3 rounded-lg bg-[var(--crm-violet-soft)] px-3 py-2 text-[11px] font-bold text-[var(--crm-violet)]">AI review is processing from the provider recording.</p>
  }
  if (review.status === 'unavailable') {
    return <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-700 dark:text-amber-300">AI review was unavailable. The saved call outcome remains authoritative.</p>
  }
  return (
    <div className="mt-3 rounded-xl border border-[var(--crm-violet)]/20 bg-[var(--crm-violet-soft)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-black text-[var(--crm-violet)]"><Icon name="auto_awesome" className="text-sm" />Post-call AI review</p>
        {attempt.lead_id ? <Link href={`/leads/${attempt.lead_id}`} prefetch={false} className="text-[10px] font-black uppercase tracking-wide text-[var(--crm-violet)] hover:underline">Review contact</Link> : null}
      </div>
      {review.summary ? <p className="mt-2 text-xs leading-5 text-[var(--crm-ink)]">{review.summary}</p> : null}
      {review.nextAction ? <p className="mt-2 text-[11px] text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">Suggested next step:</strong> {review.nextAction}</p> : null}
      {review.improvements.length ? <p className="mt-1 text-[11px] text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">Coaching:</strong> {review.improvements.join(' · ')}</p> : null}
      <p className="mt-2 text-[10px] text-[var(--crm-text-dim)]">AI-generated. Confirm the summary and suggested next step before acting.</p>
      {review.changeProposal ? <AiChangeReview proposal={review.changeProposal} sessionId={sessionId} clientAttemptId={attempt.client_attempt_id} onChange={onProposalChange} /> : null}
    </div>
  )
}

function AttemptHistory({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState<DialerHistoryPage<DurableDialerAttempt> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (cursor?: string | null) => {
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const result = await loadDialerAttemptHistory(sessionId, cursor)
      setPage((current) => cursor && current ? {
        items: [...current.items, ...result.attempts.items],
        pageInfo: result.attempts.pageInfo,
      } : result.attempts)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load call attempts.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [sessionId])

  useEffect(() => { void load() }, [load])

  if (loading) return <p className="py-5 text-center text-xs text-[var(--crm-text-muted)]">Loading call attempts…</p>
  if (error) return <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-300">{error}</p>
  if (!page?.items.length) return <p className="py-5 text-center text-xs text-[var(--crm-text-muted)]">No calls were placed in this session.</p>

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)]">
      <div className="divide-y divide-[var(--crm-border)]">
        {page.items.map((attempt) => (
          <div key={attempt.id} className="px-4 py-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_100px] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-[var(--crm-ink)]">{toProperCase(attempt.leadName) || formatPhone(attempt.phone)}</p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--crm-text-muted)]">{attempt.propertyAddress || formatPhone(attempt.phone)} · {dateTime(attempt.created_at)}</p>
              </div>
              <span className="text-xs font-bold text-[var(--crm-ink)]">{attempt.disposition ? label(attempt.disposition) : label(attempt.status)}</span>
              <span className="text-xs tabular-nums text-[var(--crm-text-muted)]">{duration(attempt.duration_seconds)}</span>
            </div>
            <PostCallReview attempt={attempt} sessionId={sessionId} onProposalChange={(proposal) => setPage((current) => current ? {
              ...current,
              items: current.items.map((item) => item.id === attempt.id ? {
                ...item,
                postCallReview: { ...item.postCallReview, changeProposal: proposal },
              } : item),
            } : current)} />
          </div>
        ))}
      </div>
      {page.pageInfo.hasMore ? (
        <button type="button" disabled={loadingMore} onClick={() => void load(page.pageInfo.nextCursor)} className="w-full border-t border-[var(--crm-border)] px-4 py-2.5 text-xs font-black text-[var(--crm-brand)] hover:bg-[var(--crm-surface-subtle)] disabled:opacity-50">
          {loadingMore ? 'Loading…' : 'Load older attempts'}
        </button>
      ) : null}
    </div>
  )
}

function SessionCard({ session, expanded, onToggle, onResume }: { session: DurableDialerSession; expanded: boolean; onToggle: () => void; onResume: () => void }) {
  const progress = Math.min(100, Math.round(((session.currentIndex + (session.status === 'completed' ? 1 : 0)) / Math.max(session.queueSize, 1)) * 100))
  const contactRate = session.dialsCompleted > 0 ? Math.round((session.contacts / session.dialsCompleted) * 100) : 0
  const outcomeSummary = Object.entries(session.outcomes || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
  return (
    <article className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name="phone_in_talk" className="text-xl" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-black text-[var(--crm-ink)]">{label(session.queueKey)}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusTone(session.status)}`}>{session.status}</span>
          </div>
          <p className="mt-1 text-xs text-[var(--crm-text-muted)]">{dateTime(session.startedAt)} · {session.agentName} · {formatPhone(session.callerId)}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--crm-surface)]"><div className="h-full rounded-full bg-[var(--crm-brand)]" style={{ width: `${progress}%` }} /></div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--crm-text-muted)]">
            <span><strong className="text-[var(--crm-ink)]">{session.dialsCompleted}</strong> dials</span>
            <span><strong className="text-[var(--crm-ink)]">{session.contacts}</strong> contacts</span>
            <span><strong className="text-[var(--crm-ink)]">{contactRate}%</strong> contact rate</span>
            <span><strong className="text-[var(--crm-ink)]">{Math.min(session.currentIndex + 1, session.queueSize)}</strong> of {session.queueSize}</span>
          </div>
          {outcomeSummary.length ? <p className="mt-2 text-[11px] text-[var(--crm-text-muted)]">{outcomeSummary.map(([outcome, count]) => `${label(outcome)} ${count}`).join(' · ')}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {(session.status === 'active' || session.status === 'paused') ? <button type="button" onClick={onResume} className="rounded-lg bg-[var(--crm-brand)] px-3 py-2 text-xs font-black text-white hover:bg-[var(--crm-brand-hover)]">Open session</button> : null}
          <button type="button" aria-expanded={expanded} onClick={onToggle} className="rounded-lg border border-[var(--crm-border-strong)] px-3 py-2 text-xs font-black text-[var(--crm-ink)] hover:bg-[var(--crm-surface)]">{expanded ? 'Hide calls' : 'View calls'}</button>
        </div>
      </div>
      {expanded ? <AttemptHistory sessionId={session.id} /> : null}
    </article>
  )
}

export function DialerSessionHistory({ onResume, onOpenQueue }: DialerSessionHistoryProps) {
  const [page, setPage] = useState<DialerHistoryPage<DurableDialerSession> | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (cursor?: string | null) => {
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const result = await loadDialerSessionHistory(cursor)
      setPage((current) => cursor && current ? { items: [...current.items, ...result.items], pageInfo: result.pageInfo } : result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load dialer sessions.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  const openSessions = useMemo(() => page?.items.filter((session) => session.status === 'active' || session.status === 'paused') || [], [page])
  const closedSessions = useMemo(() => page?.items.filter((session) => session.status === 'completed' || session.status === 'stopped') || [], [page])

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--crm-brand)]">Dialer sessions</p><h1 className="mt-1 text-2xl font-black text-[var(--crm-ink)]">Calling history you can trust</h1><p className="mt-2 max-w-2xl text-sm text-[var(--crm-text-muted)]">Resume server-saved work, audit every call attempt, and compare outcomes without rebuilding a queue.</p></div>
        <button type="button" onClick={onOpenQueue} className="rounded-lg bg-[var(--crm-brand)] px-4 py-2.5 text-sm font-black text-white hover:bg-[var(--crm-brand-hover)]">New calling session</button>
      </div>
      {error ? <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-bold text-red-700 dark:text-red-300"><span>{error}</span><button type="button" onClick={() => void load()} className="text-xs underline">Retry</button></div> : null}
      {loading ? <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-10 text-center text-sm text-[var(--crm-text-muted)]">Loading durable sessions…</div> : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between"><h2 className="text-lg font-black text-[var(--crm-ink)]">Active and paused</h2><span className="text-xs font-bold text-[var(--crm-text-muted)]">{openSessions.length} open</span></div>
            <div className="mt-4 space-y-3">{openSessions.map((session) => <SessionCard key={session.id} session={session} expanded={expandedId === session.id} onToggle={() => setExpandedId((current) => current === session.id ? null : session.id)} onResume={() => onResume(session)} />)}
              {openSessions.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--crm-border-strong)] p-8 text-center"><Icon name="pause_circle" className="text-3xl text-[var(--crm-text-dim)]" /><p className="mt-2 text-sm font-bold text-[var(--crm-ink)]">No open session</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Start a queue and the server will preserve your exact place.</p></div> : null}
            </div>
          </section>
          <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black text-[var(--crm-ink)]">Recent history</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Completed and stopped sessions for your signed-in account.</p></div><Link href="/reports/call-sms" className="inline-flex items-center gap-1 text-xs font-black text-[var(--crm-brand)]">Team calling report <Icon name="arrow_forward" className="text-sm" /></Link></div>
            <div className="mt-4 space-y-3">{closedSessions.map((session) => <SessionCard key={session.id} session={session} expanded={expandedId === session.id} onToggle={() => setExpandedId((current) => current === session.id ? null : session.id)} onResume={() => onResume(session)} />)}
              {closedSessions.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--crm-border-strong)] p-6 text-center text-xs text-[var(--crm-text-muted)]">Completed sessions will appear here with their saved outcomes.</p> : null}
            </div>
            {page?.pageInfo.hasMore ? <button type="button" disabled={loadingMore} onClick={() => void load(page.pageInfo.nextCursor)} className="mt-4 w-full rounded-lg border border-[var(--crm-border-strong)] px-4 py-2.5 text-xs font-black text-[var(--crm-ink)] hover:bg-[var(--crm-surface-subtle)] disabled:opacity-50">{loadingMore ? 'Loading…' : 'Load older sessions'}</button> : null}
          </section>
        </div>
      )}
    </div>
  )
}
