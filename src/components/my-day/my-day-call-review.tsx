'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { CALL_SCORE_RUBRIC, getCallReviewFramework, type CallReviewFrameworkId } from '@/lib/call-review-frameworks'

type Workflow = {
  status: 'available' | 'submitted' | 'completed'
  framework: CallReviewFrameworkId | null
  score: number | null
  submittedBy: string | null
  assignedReviewer: string | null
  completedBy?: string | null
  reviewNote?: string | null
  tags: string[]
}

type ReviewCall = {
  id: string
  leadName: string
  recordingUrl: string
  durationSeconds: number
  analysisSummary: string | null
  reviewWorkflow: Workflow
}

type QueueView = 'assigned' | 'completed'

function testCall(viewerEmail: string): ReviewCall {
  return {
    id: 'test-review-preview',
    leadName: 'TEST SCORECARD - Jordan Seller',
    recordingUrl: '/audio/ivr-voicemail.mp3',
    durationSeconds: 74,
    analysisSummary: 'Confirm motivation, timeline, decision makers, and a committed next step.',
    reviewWorkflow: { status: 'submitted', framework: 'junior_acquisitions', score: null, submittedBy: 'casey@savingkc.com', assignedReviewer: viewerEmail, tags: ['Needs Coaching', 'Motivation'] },
  }
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function MyDayCallReview() {
  const [calls, setCalls] = useState<ReviewCall[]>([])
  const [viewerEmail, setViewerEmail] = useState('')
  const [view, setView] = useState<QueueView>('assigned')
  const [reviewing, setReviewing] = useState<ReviewCall | null>(null)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/marketing/call-recordings?days=30&minDuration=30', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Scorecard reviews could not load.')))
      .then((payload: { recordings: ReviewCall[]; viewerEmail: string }) => {
        const preview = window.location.hostname.endsWith('.vercel.app') || window.location.hostname === 'localhost'
        const submitted = payload.recordings.filter((call) => call.reviewWorkflow.status !== 'available')
        setCalls(preview && !submitted.some((call) => call.id === 'test-review-preview') ? [testCall(payload.viewerEmail), ...submitted] : submitted)
        setViewerEmail(payload.viewerEmail || '')
      })
      .catch((reason: Error) => setError(reason.message))
  }, [])

  const visibleCalls = useMemo(() => calls.filter((call) => view === 'assigned'
    ? call.reviewWorkflow.status === 'submitted' && call.reviewWorkflow.assignedReviewer === viewerEmail
    : call.reviewWorkflow.status === 'completed' && (call.reviewWorkflow.submittedBy === viewerEmail || call.reviewWorkflow.assignedReviewer === viewerEmail)
  ).slice(0, 6), [calls, view, viewerEmail])

  const assigned = calls.filter((call) => call.reviewWorkflow.status === 'submitted' && call.reviewWorkflow.assignedReviewer === viewerEmail).length
  const framework = reviewing ? getCallReviewFramework(reviewing.reviewWorkflow.framework || 'junior_acquisitions') : null
  const itemCount = framework?.sections.reduce((count, section) => count + section.items.length, 0) || 0
  const liveScore = itemCount ? Math.round((Object.values(ratings).reduce((sum, rating) => sum + rating, 0) / itemCount) * 100) / 100 : 0

  function openReview(call: ReviewCall) {
    setReviewing(call)
    setRatings({})
    setNote('')
  }

  async function completeReview(call: ReviewCall) {
    const frameworkId = call.reviewWorkflow.framework || 'junior_acquisitions'
    setBusy(true)
    setError(null)
    try {
      let workflow: Workflow
      if (call.id === 'test-review-preview') {
        workflow = { ...call.reviewWorkflow, status: 'completed', score: liveScore, completedBy: viewerEmail, reviewNote: note }
      } else {
        const response = await fetch('/api/marketing/call-recordings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activityId: call.id, action: 'complete', framework: frameworkId, answers: ratings, note }),
        })
        const payload = await response.json() as { error?: string; workflow?: Workflow }
        if (!response.ok || !payload.workflow) throw new Error(payload.error || 'Scorecard could not be saved.')
        workflow = payload.workflow
      }
      setCalls((current) => current.map((item) => item.id === call.id ? { ...item, reviewWorkflow: workflow } : item))
      setReviewing(null)
      setRatings({})
      setNote('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Scorecard could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section aria-labelledby="scorecard-reviews-title" className="crm-panel overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--crm-border)] px-5 py-4">
        <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name="fact_check" /></span><div><h2 id="scorecard-reviews-title" className="text-[20px] font-black">Scorecard Reviews</h2><p className="text-[11px] font-semibold text-[var(--crm-text-muted)]">Only calls intentionally submitted for review appear here.</p></div></div>
        <div className="flex rounded-lg border border-[var(--crm-border)] p-1 text-xs font-black">{([['assigned', `Assigned to me (${assigned})`], ['completed', 'Completed']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setView(key)} className={`rounded-md px-3 py-2 ${view === key ? 'bg-[var(--crm-brand)] text-white' : 'text-[var(--crm-text-muted)]'}`}>{label}</button>)}</div>
      </div>
      {error ? <p className="m-4 rounded-lg bg-[var(--crm-danger-soft)] p-3 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
      {visibleCalls.length === 0 ? <div className="flex min-h-24 items-center justify-center gap-2 text-sm font-bold text-[var(--crm-text-muted)]"><Icon name="task_alt" className="text-[var(--crm-success)]" />No scorecards in this view</div> : <div className="divide-y divide-[var(--crm-border)]">{visibleCalls.map((call) => <div key={call.id} className="grid items-center gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_210px_220px_125px]"><div><p className="font-black">{call.leadName}</p><p className="text-[11px] text-[var(--crm-text-muted)]">{call.reviewWorkflow.status === 'completed' ? `${call.reviewWorkflow.score ?? 0} / 3 · ${call.reviewWorkflow.completedBy || 'Reviewed'}` : `Submitted for review · ${formatDuration(call.durationSeconds)}`}</p><div className="mt-1 flex flex-wrap gap-1">{call.reviewWorkflow.tags.map((tag) => <span key={tag} className="rounded-full bg-[var(--crm-info-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-info)]">{tag}</span>)}</div></div><audio controls preload="none" src={call.recordingUrl} className="h-8 w-full" /><span className="truncate text-xs font-bold text-[var(--crm-text-muted)]">{getCallReviewFramework(call.reviewWorkflow.framework)?.label || 'Jr. Acquisitions Scorecard'}</span><button disabled={busy || call.reviewWorkflow.status === 'completed'} onClick={() => openReview(call)} className="crm-primary-button h-9 rounded-md px-3 text-xs font-black">{call.reviewWorkflow.status === 'completed' ? 'Complete' : 'Score Call'}</button></div>)}</div>}
    </section>
    {reviewing && framework ? <div className="fixed inset-0 z-50 flex justify-end bg-black/60"><section role="dialog" aria-modal="true" aria-labelledby="scorecard-title" className="h-full w-full max-w-[760px] overflow-y-auto bg-[var(--crm-surface)] p-5 shadow-2xl"><div className="flex justify-between"><div><p className="crm-eyebrow">{framework.label}</p><h2 id="scorecard-title" className="text-2xl font-black">{reviewing.leadName}</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Rate every behavior from 0 to 3.</p></div><button aria-label="Close scorecard" onClick={() => setReviewing(null)} className="crm-icon-button h-9 w-9 rounded-lg"><Icon name="close" /></button></div><audio controls src={reviewing.recordingUrl} className="mt-4 w-full" /><div className="mt-3 grid grid-cols-4 gap-2">{CALL_SCORE_RUBRIC.map((level) => <div key={level.value} className="rounded-lg border border-[var(--crm-border)] p-2"><strong className="text-xs">{level.value} - {level.label}</strong><p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">{level.description}</p></div>)}</div>{reviewing.analysisSummary ? <p className="mt-3 rounded-lg bg-[var(--crm-info-soft)] p-3 text-sm">{reviewing.analysisSummary}</p> : null}<div className="mt-5 space-y-5">{framework.sections.map((section) => <fieldset key={section.label}><legend className="mb-2 text-sm font-black">{section.label}</legend><div className="space-y-2">{section.items.map((item) => <div key={item.id} className="grid items-center gap-3 rounded-lg border border-[var(--crm-border)] p-3 sm:grid-cols-[minmax(0,1fr)_240px]"><span className="text-sm font-semibold">{item.label}</span><div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={item.label}>{CALL_SCORE_RUBRIC.map((level) => <label key={level.value} className={`cursor-pointer rounded-md border px-2 py-2 text-center text-xs font-black ${ratings[item.id] === level.value ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'border-[var(--crm-border)]'}`}><input className="sr-only" type="radio" name={item.id} value={level.value} checked={ratings[item.id] === level.value} onChange={() => setRatings((current) => ({ ...current, [item.id]: level.value }))} />{level.value}</label>)}</div></div>)}</div></fieldset>)}</div><label className="mt-5 block text-xs font-black">Coaching note<textarea value={note} onChange={(event) => setNote(event.target.value)} className="crm-field mt-2 min-h-24 w-full rounded-lg p-3 text-sm font-normal" /></label><div className="sticky bottom-0 mt-5 flex items-center justify-between border-t border-[var(--crm-border)] bg-[var(--crm-surface)] py-4"><strong>{liveScore} / 3</strong><button disabled={busy || Object.keys(ratings).length !== itemCount} onClick={() => void completeReview(reviewing)} className="crm-primary-button rounded-lg px-5 py-3 text-sm font-black">Complete Scorecard</button></div></section></div> : null}
  </>
}
