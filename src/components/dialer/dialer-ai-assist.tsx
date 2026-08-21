'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { parseDialerPreCallBrief, type DialerPreCallBrief } from '@/lib/dialer-pre-call-brief'

function formatDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
}

function pretty(value: string | null) {
  return value?.replace(/_/g, ' ') || null
}

export function DialerAiAssist({ sessionId, leadId }: { sessionId: string | null; leadId: string }) {
  const [brief, setBrief] = useState<DialerPreCallBrief | null>(null)
  const [loading, setLoading] = useState(Boolean(sessionId))
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    void fetch(`/api/dialer/sessions/${encodeURIComponent(sessionId)}/pre-call-brief`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Pre-call brief is unavailable.')
      const next = parseDialerPreCallBrief(body?.brief)
      if (!next || next.leadId !== leadId) throw new Error('Pre-call brief is not ready for this contact.')
      if (controller.signal.aborted) return
      setBrief(next)
    }).catch((caught) => {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setError(caught instanceof Error ? caught.message : 'Pre-call brief is unavailable.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [leadId, retry, sessionId])

  return (
    <section aria-label="Pre-call brief" className="rounded-xl border border-[var(--crm-violet)]/25 bg-[var(--crm-violet-soft)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon name="auto_awesome" className="mt-0.5 shrink-0 text-lg text-[var(--crm-violet)]" />
          <div>
            <p className="text-xs font-black text-[var(--crm-ink)]">Pre-call brief</p>
            <p className="mt-0.5 text-[11px] leading-5 text-[var(--crm-text-muted)]">A bounded, read-only snapshot. Opening it never generates, sends, or saves anything.</p>
          </div>
        </div>
        <Link href={`/leads/${leadId}`} prefetch={false} className="shrink-0 text-[10px] font-black uppercase tracking-wider text-[var(--crm-violet)] hover:underline">Review profile</Link>
      </div>

      {!sessionId ? (
        <p className="mt-3 rounded-lg bg-[var(--crm-surface)] px-3 py-2 text-[11px] text-[var(--crm-text-muted)]">Start or resume a saved calling session to load verified pre-call context.</p>
      ) : loading ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-[11px] text-[var(--crm-text-muted)]"><Icon name="progress_activity" className="animate-spin text-sm" />Loading current contact evidence…</p>
      ) : error ? (
        <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
          <p role="alert" className="font-bold">{error}</p>
          <button type="button" onClick={() => { setBrief(null); setLoading(true); setError(null); setRetry((value) => value + 1) }} className="mt-1 font-black underline">Try again</button>
        </div>
      ) : brief ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-violet)]">Call objective</p>
              {brief.objective?.dueAt ? <span className="text-[10px] font-bold text-[var(--crm-text-muted)]">{formatDate(brief.objective.dueAt)}</span> : null}
            </div>
            <p className="mt-1 text-sm font-black text-[var(--crm-ink)]">{brief.objective?.title || 'Agree on one specific next step'}</p>
            {brief.objective?.description ? <p className="mt-1 text-[11px] leading-5 text-[var(--crm-text-muted)]">{brief.objective.description}</p> : null}
          </div>

          {brief.aiBriefing ? (
            <div className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-violet)]">Stored AI briefing</p>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${brief.aiBriefing.freshness === 'current' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
                  {brief.aiBriefing.freshness === 'current' ? 'Current' : 'Newer activity exists'}
                </span>
              </div>
              {brief.aiBriefing.situation ? <p className="mt-2 text-[11px] leading-5 text-[var(--crm-ink)]">{brief.aiBriefing.situation}</p> : null}
              {brief.aiBriefing.motivation ? <p className="mt-2 text-[11px] leading-5 text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">Motivation:</strong> {brief.aiBriefing.motivation}</p> : null}
              {brief.aiBriefing.strategy ? <p className="mt-1 text-[11px] leading-5 text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">Approach:</strong> {brief.aiBriefing.strategy}</p> : null}
            </div>
          ) : null}

          {brief.facts.length ? (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {brief.facts.map((fact) => <div key={fact.label} className="rounded-lg bg-[var(--crm-surface)] px-3 py-2"><dt className="text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-dim)]">{fact.label}</dt><dd className="mt-0.5 text-[11px] font-bold capitalize text-[var(--crm-ink)]">{fact.value}</dd></div>)}
            </dl>
          ) : null}

          {brief.questions.length ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Questions that still matter</p>
              <ul className="mt-1.5 space-y-1">{brief.questions.map((question) => <li key={question} className="flex gap-2 text-[11px] leading-5 text-[var(--crm-ink)]"><span aria-hidden="true" className="text-[var(--crm-violet)]">•</span><span>{question}</span></li>)}</ul>
            </div>
          ) : null}

          {brief.recentEvidence.length ? (
            <details>
              <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Recent evidence ({brief.recentEvidence.length})</summary>
              <ul className="mt-2 space-y-1.5">{brief.recentEvidence.map((item) => <li key={item.id} className="rounded-lg bg-[var(--crm-surface)] px-3 py-2 text-[10px] text-[var(--crm-text-muted)]"><span className="font-black capitalize text-[var(--crm-ink)]">{pretty(item.direction) || pretty(item.kind)}</span><span aria-hidden="true"> · </span>{item.summary}<span className="ml-1 text-[var(--crm-text-dim)]">{formatDate(item.createdAt)}</span></li>)}</ul>
            </details>
          ) : null}

          <p className="text-[9px] text-[var(--crm-text-dim)]">Snapshot {formatDate(brief.snapshotAt)} from {brief.sourceRowCount} bounded source rows. Verify critical facts with the seller.</p>
        </div>
      ) : null}
    </section>
  )
}
