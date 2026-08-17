'use client'

import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { CALL_SCORE_RUBRIC, getCallReviewFramework, type CallReviewFrameworkId } from '@/lib/call-review-frameworks'

type CompletedWorkflow = {
  status: 'available' | 'submitted' | 'completed'
  framework: CallReviewFrameworkId | null
  submittedAt: string | null
  submittedBy: string | null
  assignedReviewer: string | null
  completedAt: string | null
  completedBy: string | null
  score: number | null
  answers: Record<string, number>
  tags: string[]
  reviewNote: string | null
  voiceoverPath: string | null
  voiceoverMimeType: string | null
}

type ScorecardCall = {
  id: string
  leadId: string | null
  leadName: string
  leadUrl: string | null
  leadSource: string | null
  propertyAddress: string | null
  city: string | null
  state: string | null
  recordingUrl: string
  direction: string | null
  durationSeconds: number
  createdAt: string
  analysisSummary: string | null
  reviewWorkflow: CompletedWorkflow
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}` : `${minutes}:${String(remaining).padStart(2, '0')}`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function reviewerName(value: string | null) {
  if (!value) return '—'
  const name = value.split('@')[0].replace(/[._-]+/g, ' ')
  return name.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function address(call: ScorecardCall) {
  return [call.propertyAddress, call.city, call.state].filter(Boolean).join(', ') || 'No property linked'
}

function previewCompletedCall(): ScorecardCall {
  const framework = getCallReviewFramework('junior_acquisitions')!
  const answers = Object.fromEntries(framework.sections.flatMap((section, sectionIndex) => section.items.map((item, itemIndex) => [item.id, (sectionIndex + itemIndex) % 4])))
  const values = Object.values(answers)
  const score = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
  return {
    id: 'test-completed-scorecard',
    leadId: null,
    leadName: 'Jordan Seller',
    leadUrl: null,
    leadSource: 'Google Ads',
    propertyAddress: '123 Test Property',
    city: 'Kansas City',
    state: 'MO',
    recordingUrl: '/audio/ivr-voicemail.mp3',
    direction: 'inbound',
    durationSeconds: 754,
    createdAt: new Date().toISOString(),
    analysisSummary: 'Jordan wants to resolve the property within 30 days. Motivation and condition were covered well; price discovery and the committed next step need coaching.',
    reviewWorkflow: {
      status: 'completed', framework: 'junior_acquisitions', submittedAt: new Date().toISOString(), submittedBy: 'casey@savingkc.com', assignedReviewer: 'ernest@savingkc.com', completedAt: new Date().toISOString(), completedBy: 'ernest@savingkc.com', score, answers, tags: ['Needs Coaching', 'Motivation', 'Price'], reviewNote: 'Strong empathy and discovery. Ask for the price more directly and lock in a specific next conversation date and time.', voiceoverPath: '/audio/ivr-voicemail.mp3', voiceoverMimeType: 'audio/mpeg',
    },
  }
}

function ScorePill({ score }: { score: number | null }) {
  const value = score ?? 0
  const tone = value >= 2.5 ? 'var(--crm-success)' : value >= 1.5 ? 'var(--crm-warning)' : 'var(--crm-danger)'
  return <span className="inline-flex min-w-16 items-center justify-center rounded-full px-3 py-1 text-xs font-black" style={{ background: `color-mix(in srgb, ${tone} 15%, transparent)`, color: tone }}>{value.toFixed(2)} / 3</span>
}

export function ScorecardResultsPage() {
  const [calls, setCalls] = useState<ScorecardCall[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/marketing/call-recordings?days=365&minDuration=5', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Completed scorecards could not load.')))
      .then((payload: { recordings: ScorecardCall[] }) => {
        const completed = payload.recordings.filter((call) => call.reviewWorkflow.status === 'completed')
        const preview = window.location.hostname.endsWith('.vercel.app') || window.location.hostname === 'localhost'
        setCalls(preview ? [previewCompletedCall(), ...completed.filter((call) => call.id !== 'test-completed-scorecard')] : completed)
      })
      .catch((reason: Error) => { if (reason.name !== 'AbortError') setError(reason.message) })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  const average = useMemo(() => calls.length ? calls.reduce((sum, call) => sum + (call.reviewWorkflow.score || 0), 0) / calls.length : 0, [calls])

  return <main className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="crm-eyebrow">Call coaching</p>
        <h1 className="text-3xl font-black tracking-tight">Scorecard</h1>
        <p className="mt-1 text-sm text-[var(--crm-text-muted)]">Completed call reviews and coaching results.</p>
      </div>
      <Link href="/marketing/calls" className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-lg px-4 text-xs font-black"><Icon name="headphones" />Open Call Recordings</Link>
    </header>

    <section aria-label="Scorecard summary" className="grid gap-3 sm:grid-cols-3">
      <div className="crm-panel rounded-xl p-4"><p className="text-[11px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Completed reviews</p><strong className="mt-1 block text-2xl">{calls.length}</strong></div>
      <div className="crm-panel rounded-xl p-4"><p className="text-[11px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Average score</p><strong className="mt-1 block text-2xl">{average.toFixed(2)} / 3</strong></div>
      <div className="crm-panel rounded-xl p-4"><p className="text-[11px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Needs coaching</p><strong className="mt-1 block text-2xl">{calls.filter((call) => (call.reviewWorkflow.score || 0) < 2.5).length}</strong></div>
    </section>

    <section aria-labelledby="completed-scorecards-title" className="crm-panel overflow-hidden rounded-xl">
      <div className="border-b border-[var(--crm-border)] px-5 py-4"><h2 id="completed-scorecards-title" className="text-xl font-black">Reviewed Calls</h2><p className="text-xs text-[var(--crm-text-muted)]">Expand a reviewed call to see the complete scorecard.</p></div>
      {error ? <p className="m-4 rounded-lg bg-[var(--crm-danger-soft)] p-3 text-sm font-bold text-[var(--crm-danger)]">{error}</p> : null}
      {loading ? <div className="p-8 text-center text-sm font-bold text-[var(--crm-text-muted)]">Loading scorecards…</div> : null}
      {!loading && calls.length === 0 ? <div className="p-10 text-center"><Icon name="fact_check" className="text-3xl text-[var(--crm-success)]" /><p className="mt-2 font-black">No completed scorecards yet</p><p className="text-xs text-[var(--crm-text-muted)]">Completed call reviews will appear here automatically.</p></div> : null}
      {calls.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1000px] border-collapse text-left">
        <thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Property address</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Reviewer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Score</th><th className="px-5 py-3 text-right">View</th></tr></thead>
        <tbody className="divide-y divide-[var(--crm-border)]">{calls.map((call) => {
          const expanded = expandedId === call.id
          const framework = getCallReviewFramework(call.reviewWorkflow.framework || 'junior_acquisitions')
          return <Fragment key={call.id}>
            <tr className="hover:bg-[var(--crm-surface-subtle)]"><td className="px-5 py-4"><p className="font-black">{address(call)}</p><p className="text-[11px] text-[var(--crm-text-muted)]">{formatDate(call.createdAt)}</p></td><td className="px-4 py-4"><p className="font-bold">{call.leadName}</p><p className="text-[11px] text-[var(--crm-text-muted)]">{call.leadSource || 'Direct'}</p></td><td className="px-4 py-4"><span className="rounded-full bg-[var(--crm-info-soft)] px-2 py-1 text-[11px] font-black capitalize text-[var(--crm-info)]">{call.direction || 'Call'}</span></td><td className="px-4 py-4 text-sm font-bold">{reviewerName(call.reviewWorkflow.completedBy)}</td><td className="px-4 py-4"><span className="inline-flex items-center gap-1 text-xs font-black text-[var(--crm-success)]"><Icon name="check_circle" />Reviewed</span></td><td className="px-4 py-4 text-sm font-bold">{formatDuration(call.durationSeconds)}</td><td className="px-4 py-4"><ScorePill score={call.reviewWorkflow.score} /></td><td className="px-5 py-4 text-right"><button type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : call.id)} className="crm-secondary-button inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-black"><Icon name="visibility" />{expanded ? 'Close' : 'View'}<Icon name={expanded ? 'expand_less' : 'expand_more'} /></button></td></tr>
            {expanded && framework ? <tr><td colSpan={8} className="bg-[var(--crm-surface-subtle)] p-5"><div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
              <aside className="space-y-4"><div className="crm-panel rounded-xl p-4"><p className="crm-eyebrow">Call details</p><dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-[var(--crm-text-muted)]">Owner</dt><dd className="mt-1 font-black">{call.leadName}</dd></div><div><dt className="text-[var(--crm-text-muted)]">Property</dt><dd className="mt-1 font-black">{address(call)}</dd></div><div><dt className="text-[var(--crm-text-muted)]">Call type</dt><dd className="mt-1 font-black capitalize">{call.direction || 'Call'}</dd></div><div><dt className="text-[var(--crm-text-muted)]">Duration</dt><dd className="mt-1 font-black">{formatDuration(call.durationSeconds)}</dd></div><div><dt className="text-[var(--crm-text-muted)]">Reviewed by</dt><dd className="mt-1 font-black">{reviewerName(call.reviewWorkflow.completedBy)}</dd></div><div><dt className="text-[var(--crm-text-muted)]">Reviewed</dt><dd className="mt-1 font-black">{formatDate(call.reviewWorkflow.completedAt)}</dd></div></dl>{call.leadUrl ? <Link href={call.leadUrl} className="mt-4 inline-flex items-center gap-1 text-xs font-black text-[var(--crm-info)]">Open contact <Icon name="open_in_new" /></Link> : null}</div><div className="crm-panel rounded-xl p-4"><p className="text-xs font-black">Original call</p><audio controls preload="none" src={call.recordingUrl} className="mt-3 w-full" /></div>{call.reviewWorkflow.voiceoverPath ? <div className="rounded-xl border border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] p-4"><p className="flex items-center gap-2 text-xs font-black text-[var(--crm-brand)]"><Icon name="mic" />Mixed coaching review</p><p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">Original call and reviewer commentary</p><audio controls preload="none" src={call.reviewWorkflow.voiceoverPath.startsWith('/') ? call.reviewWorkflow.voiceoverPath : `/api/marketing/call-review-voiceover?path=${encodeURIComponent(call.reviewWorkflow.voiceoverPath)}`} className="mt-3 w-full" /></div> : null}{call.analysisSummary ? <div className="crm-panel rounded-xl p-4"><p className="text-xs font-black">Call summary</p><p className="mt-2 text-sm leading-6 text-[var(--crm-text-muted)]">{call.analysisSummary}</p></div> : null}{call.reviewWorkflow.reviewNote ? <div className="rounded-xl border border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] p-4"><p className="text-xs font-black text-[var(--crm-brand)]">Coaching notes</p><p className="mt-2 text-sm leading-6">{call.reviewWorkflow.reviewNote}</p></div> : null}</aside>
              <section className="crm-panel overflow-hidden rounded-xl"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--crm-border)] p-4"><div><p className="crm-eyebrow">Completed scorecard</p><h3 className="text-lg font-black">{framework.label}</h3></div><ScorePill score={call.reviewWorkflow.score} /></div><div className="grid grid-cols-4 border-b border-[var(--crm-border)]">{CALL_SCORE_RUBRIC.map((level) => <div key={level.value} className="border-r border-[var(--crm-border)] p-3 last:border-r-0"><strong className="text-xs">{level.value} — {level.label}</strong><p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">{level.description}</p></div>)}</div><div className="divide-y divide-[var(--crm-border)]">{framework.sections.map((section) => {
                const sectionValues = section.items.map((item) => call.reviewWorkflow.answers[item.id]).filter((value): value is number => typeof value === 'number')
                const sectionScore = sectionValues.length ? sectionValues.reduce((sum, value) => sum + value, 0) / sectionValues.length : 0
                return <div key={section.label} className="p-4"><div className="mb-3 flex items-center justify-between"><h4 className="font-black">{section.label}</h4><span className="text-xs font-black text-[var(--crm-text-muted)]">{sectionScore.toFixed(2)} / 3</span></div><div className="space-y-2">{section.items.map((item) => { const value = call.reviewWorkflow.answers[item.id]; const rubric = CALL_SCORE_RUBRIC.find((level) => level.value === value); return <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_50px_120px] items-center gap-3 rounded-lg border border-[var(--crm-border)] px-3 py-2"><span className="text-xs font-semibold">{item.label}</span><strong className="text-center text-sm">{typeof value === 'number' ? value : '—'}</strong><span className="text-[10px] font-bold text-[var(--crm-text-muted)]">{rubric?.label || 'Not scored'}</span></div>})}</div></div>
              })}</div></section>
            </div></td></tr> : null}
          </Fragment>
        })}</tbody>
      </table></div> : null}
    </section>
  </main>
}
