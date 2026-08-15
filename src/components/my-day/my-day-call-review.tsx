'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { CALL_REVIEW_FRAMEWORKS, getCallReviewFramework, type CallReviewFrameworkId } from '@/lib/call-review-frameworks'

type Workflow = { status: 'available' | 'submitted' | 'completed'; framework: CallReviewFrameworkId | null; score: number | null }
type ReviewCall = { id: string; leadName: string; recordingUrl: string; durationSeconds: number; createdAt: string; analysisSummary: string | null; reviewWorkflow: Workflow }

function testCall(): ReviewCall {
  return { id: 'test-review-preview', leadName: 'TEST REVIEW — Jordan Seller', recordingUrl: '/audio/ivr-voicemail.mp3', durationSeconds: 74, createdAt: new Date().toISOString(), analysisSummary: 'Confirm motivation, timeline, decision makers, and a committed next step.', reviewWorkflow: { status: 'available', framework: null, score: null } }
}

export function MyDayCallReview() {
  const [calls, setCalls] = useState<ReviewCall[]>([])
  const [frameworks, setFrameworks] = useState<Record<string, CallReviewFrameworkId>>({})
  const [reviewing, setReviewing] = useState<ReviewCall | null>(null)
  const [answers, setAnswers] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/marketing/call-recordings?days=30&minDuration=30', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Calls could not load.')))
      .then((payload: { recordings: ReviewCall[] }) => {
        const preview = window.location.hostname.endsWith('.vercel.app') || window.location.hostname === 'localhost'
        setCalls(preview && !payload.recordings.some((call) => call.id === 'test-review-preview') ? [testCall(), ...payload.recordings] : payload.recordings)
      })
      .catch((reason: Error) => setError(reason.message))
  }, [])

  const openCalls = useMemo(() => calls.filter((call) => call.reviewWorkflow.status !== 'completed').slice(0, 4), [calls])
  const submitted = calls.filter((call) => call.reviewWorkflow.status === 'submitted').length

  async function update(call: ReviewCall, action: 'submit' | 'complete') {
    const framework = call.reviewWorkflow.framework || frameworks[call.id] || 'junior_acquisitions'
    setBusy(true); setError(null)
    try {
      let workflow: Workflow
      if (call.id === 'test-review-preview') {
        const definition = getCallReviewFramework(framework)!
        const ids = definition.sections.flatMap((section) => section.items.map((item) => item.id))
        workflow = { status: action === 'submit' ? 'submitted' : 'completed', framework, score: action === 'complete' ? Math.round((ids.filter((id) => answers[id]).length / ids.length) * 100) : null }
      } else {
        const response = await fetch('/api/marketing/call-recordings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activityId: call.id, action, framework, answers, note }) })
        const payload = await response.json() as { error?: string; workflow?: Workflow }
        if (!response.ok || !payload.workflow) throw new Error(payload.error || 'Review could not be saved.')
        workflow = payload.workflow
      }
      setCalls((current) => current.map((item) => item.id === call.id ? { ...item, reviewWorkflow: workflow } : item))
      setReviewing(null); setAnswers({}); setNote('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Review could not be saved.') } finally { setBusy(false) }
  }

  const framework = reviewing ? getCallReviewFramework(reviewing.reviewWorkflow.framework || frameworks[reviewing.id] || 'junior_acquisitions') : null
  const score = framework ? Math.round((Object.values(answers).filter(Boolean).length / framework.sections.flatMap((section) => section.items).length) * 100) : 0

  return <>
    <section aria-labelledby="call-review-title" className="crm-panel overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-[var(--crm-border)] px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name="headphones" /></span><div><h2 id="call-review-title" className="text-[20px] font-black">Call Review</h2><p className="text-[11px] font-semibold text-[var(--crm-text-muted)]">Submit a recorded call, then complete its scorecard.</p></div></div><span className="rounded-full bg-[var(--crm-brand-soft)] px-2.5 py-1 text-xs font-black text-[var(--crm-brand)]">{submitted} waiting</span></div>
      {error ? <p className="m-4 rounded-lg bg-[var(--crm-danger-soft)] p-3 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
      {openCalls.length === 0 ? <div className="flex min-h-24 items-center justify-center gap-2 text-sm font-bold text-[var(--crm-text-muted)]"><Icon name="task_alt" className="text-[var(--crm-success)]" />No calls waiting</div> : <div className="divide-y divide-[var(--crm-border)]">{openCalls.map((call) => <div key={call.id} className="grid items-center gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_180px_250px_130px]"><div><p className="font-black">{call.leadName}</p><p className="text-[11px] text-[var(--crm-text-muted)]">{call.reviewWorkflow.status === 'submitted' ? 'Submitted for review' : 'Ready to submit'} · {Math.floor(call.durationSeconds / 60)}:{String(call.durationSeconds % 60).padStart(2, '0')}</p></div><audio controls preload="none" src={call.recordingUrl} className="h-8 w-full" /><select aria-label={`Framework for ${call.leadName}`} disabled={call.reviewWorkflow.status === 'submitted'} value={call.reviewWorkflow.framework || frameworks[call.id] || 'junior_acquisitions'} onChange={(event) => setFrameworks((current) => ({ ...current, [call.id]: event.target.value as CallReviewFrameworkId }))} className="crm-field h-9 rounded-md px-2 text-xs font-bold">{CALL_REVIEW_FRAMEWORKS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button disabled={busy} onClick={() => call.reviewWorkflow.status === 'submitted' ? setReviewing(call) : void update(call, 'submit')} className="crm-primary-button h-9 rounded-md px-3 text-xs font-black">{call.reviewWorkflow.status === 'submitted' ? 'Review Now' : 'Submit Review'}</button></div>)}</div>}
    </section>
    {reviewing && framework ? <div className="fixed inset-0 z-50 flex justify-end bg-black/60"><section role="dialog" aria-modal="true" aria-labelledby="scorecard-title" className="h-full w-full max-w-[620px] overflow-y-auto bg-[var(--crm-surface)] p-5 shadow-2xl"><div className="flex justify-between"><div><p className="crm-eyebrow">{framework.label}</p><h2 id="scorecard-title" className="text-2xl font-black">{reviewing.leadName}</h2></div><button aria-label="Close review" onClick={() => setReviewing(null)} className="crm-icon-button h-9 w-9 rounded-lg"><Icon name="close" /></button></div><audio controls src={reviewing.recordingUrl} className="mt-4 w-full" />{reviewing.analysisSummary ? <p className="mt-3 rounded-lg bg-[var(--crm-info-soft)] p-3 text-sm">{reviewing.analysisSummary}</p> : null}<div className="mt-5 space-y-5">{framework.sections.map((section) => <fieldset key={section.label}><legend className="mb-2 text-sm font-black">{section.label}</legend><div className="space-y-2">{section.items.map((item) => <label key={item.id} className="flex gap-2 rounded-lg border border-[var(--crm-border)] p-3 text-sm font-semibold"><input type="checkbox" checked={answers[item.id] === true} onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.checked }))} className="accent-[var(--crm-brand)]" />{item.label}</label>)}</div></fieldset>)}</div><label className="mt-5 block text-xs font-black">Coaching note<textarea value={note} onChange={(event) => setNote(event.target.value)} className="crm-field mt-2 min-h-24 w-full rounded-lg p-3 text-sm font-normal" /></label><div className="sticky bottom-0 mt-5 flex items-center justify-between border-t border-[var(--crm-border)] bg-[var(--crm-surface)] py-4"><strong>{score}%</strong><button disabled={busy} onClick={() => void update(reviewing, 'complete')} className="crm-primary-button rounded-lg px-5 py-3 text-sm font-black">Complete Review</button></div></section></div> : null}
  </>
}
