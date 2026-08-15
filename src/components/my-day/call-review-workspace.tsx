'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CALL_REVIEW_FRAMEWORKS, getCallReviewFramework, type CallReviewFrameworkId } from '@/lib/call-review-frameworks'
import { Icon } from '@/components/ui/icon'

type Workflow = { status: 'available' | 'submitted' | 'completed'; framework: CallReviewFrameworkId | null; score: number | null; submissionNote: string | null; reviewNote: string | null }
type Call = { id: string; leadName: string; leadUrl: string | null; recordingUrl: string; durationSeconds: number; createdAt: string; analysisSummary: string | null; reviewWorkflow: Workflow }

function duration(value: number) { return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` }

function previewTestCall(): Call {
  return {
    id: 'test-review-preview',
    leadName: 'TEST REVIEW — Jordan Seller',
    leadUrl: null,
    recordingUrl: '/audio/ivr-voicemail.mp3',
    durationSeconds: 74,
    createdAt: new Date().toISOString(),
    analysisSummary: 'Test coaching opportunity: confirm motivation, timeline, decision makers, and a committed next step.',
    reviewWorkflow: { status: 'available', framework: null, score: null, submissionNote: null, reviewNote: null },
  }
}

export function CallReviewWorkspace() {
  const [calls, setCalls] = useState<Call[]>([])
  const [tab, setTab] = useState<'submit' | 'review'>('review')
  const [selected, setSelected] = useState<Call | null>(null)
  const [frameworks, setFrameworks] = useState<Record<string, CallReviewFrameworkId>>({})
  const [answers, setAnswers] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const response = await fetch('/api/marketing/call-recordings?days=30&minDuration=30', { cache: 'no-store' })
    if (!response.ok) throw new Error('Call review queue could not load.')
    const payload = await response.json() as { recordings: Call[] }
    const isPreview = window.location.hostname.endsWith('.vercel.app') || window.location.hostname === 'localhost'
    const recordings = isPreview && !payload.recordings.some((call) => call.id === 'test-review-preview')
      ? [previewTestCall(), ...payload.recordings]
      : payload.recordings
    setCalls(recordings)
    const requested = new URLSearchParams(window.location.search).get('activity')
    if (requested) {
      const match = recordings.find((call) => call.id === requested)
      if (match) { setSelected(match); setTab(match.reviewWorkflow.status === 'submitted' ? 'review' : 'submit') }
    } else if (isPreview && recordings.some((call) => call.id === 'test-review-preview')) {
      setTab('submit')
    }
  }

  useEffect(() => { void load().catch((reason) => setError(reason.message)) }, [])
  const visible = useMemo(() => calls.filter((call) => tab === 'review' ? call.reviewWorkflow.status === 'submitted' : call.reviewWorkflow.status === 'available'), [calls, tab])
  const activeFramework = selected ? getCallReviewFramework(selected.reviewWorkflow.framework || frameworks[selected.id] || 'junior_acquisitions') : null

  async function save(action: 'submit' | 'complete', call: Call) {
    const framework = call.reviewWorkflow.framework || frameworks[call.id] || 'junior_acquisitions'
    setBusy(true); setError(null)
    try {
      if (call.id === 'test-review-preview') {
        const definition = getCallReviewFramework(framework)!
        const itemIds = definition.sections.flatMap((section) => section.items.map((item) => item.id))
        const score = action === 'complete' ? Math.round((itemIds.filter((id) => answers[id] === true).length / itemIds.length) * 100) : null
        setCalls((current) => current.map((item) => item.id === call.id ? {
          ...item,
          reviewWorkflow: { ...item.reviewWorkflow, status: action === 'submit' ? 'submitted' : 'completed', framework, score, submissionNote: action === 'submit' ? note : item.reviewWorkflow.submissionNote, reviewNote: action === 'complete' ? note : null },
        } : item))
        setSelected(null); setAnswers({}); setNote(''); setTab('review');
        return
      }
      const response = await fetch('/api/marketing/call-recordings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activityId: call.id, action, framework, answers, note }) })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'The review could not be saved.')
      setSelected(null); setAnswers({}); setNote(''); setTab('review'); await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The review could not be saved.') } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto w-full max-w-[1240px] px-5 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><Link href="/my-day" className="text-xs font-black text-[var(--crm-info)]">← My Day</Link><h1 className="mt-2 text-[30px] font-black tracking-[-0.04em]">Call Review</h1><p className="text-sm text-[var(--crm-text-muted)]">Submit a recorded call, then complete its framework scorecard.</p></div><div className="flex rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-1"><button onClick={() => { setTab('submit'); setSelected(null) }} className={`rounded-md px-4 py-2 text-xs font-black ${tab === 'submit' ? 'bg-[var(--crm-brand)] text-white' : ''}`}>Submit calls</button><button onClick={() => { setTab('review'); setSelected(null) }} className={`rounded-md px-4 py-2 text-xs font-black ${tab === 'review' ? 'bg-[var(--crm-brand)] text-white' : ''}`}>Review queue ({calls.filter((call) => call.reviewWorkflow.status === 'submitted').length})</button></div></header>
      {calls.some((call) => call.id === 'test-review-preview') ? <div className="mb-3 rounded-lg border border-[var(--crm-info)]/35 bg-[var(--crm-info-soft)] px-4 py-3 text-xs font-bold text-[var(--crm-info)]">Preview test enabled: open <strong>Submit calls</strong>, submit “TEST REVIEW — Jordan Seller,” then complete it from the Review queue. No CRM data will be changed.</div> : null}
      {error ? <div role="alert" className="mb-3 rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] p-3 text-sm font-bold text-[var(--crm-danger)]">{error}</div> : null}
      <section className="crm-panel overflow-hidden rounded-xl">
        {visible.length === 0 ? <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-bold text-[var(--crm-text-muted)]"><Icon name="task_alt" className="text-[var(--crm-success)]" />{tab === 'review' ? 'No submitted calls waiting for review' : 'No available recorded calls'}</div> : visible.map((call) => (
          <div key={call.id} className="grid items-center gap-3 border-b border-[var(--crm-border)] px-5 py-4 last:border-0 md:grid-cols-[minmax(0,1fr)_120px_240px_100px]"><div><p className="font-black">{call.leadName}</p><p className="text-xs text-[var(--crm-text-muted)]">{new Date(call.createdAt).toLocaleString()} · {duration(call.durationSeconds)}</p></div><audio controls preload="none" src={call.recordingUrl} className="h-8 w-full" />{tab === 'submit' ? <select aria-label={`Framework for ${call.leadName}`} value={frameworks[call.id] || 'junior_acquisitions'} onChange={(event) => setFrameworks((current) => ({ ...current, [call.id]: event.target.value as CallReviewFrameworkId }))} className="crm-field h-9 rounded-md px-2 text-xs font-bold">{CALL_REVIEW_FRAMEWORKS.map((framework) => <option key={framework.id} value={framework.id}>{framework.label}</option>)}</select> : <span className="text-xs font-bold text-[var(--crm-text-muted)]">{getCallReviewFramework(call.reviewWorkflow.framework)?.label}</span>}<button onClick={() => tab === 'submit' ? void save('submit', call) : setSelected(call)} disabled={busy} className="crm-primary-button h-9 rounded-md px-3 text-xs font-black">{tab === 'submit' ? 'Submit' : 'Review'}</button></div>
        ))}
      </section>
      {selected && activeFramework ? <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 p-4 sm:p-8"><section role="dialog" aria-modal="true" aria-labelledby="review-dialog-title" className="crm-panel w-full max-w-3xl rounded-xl p-5"><div className="flex justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.12em] text-[var(--crm-brand)]">{activeFramework.label}</p><h2 id="review-dialog-title" className="text-2xl font-black">Review {selected.leadName}</h2></div><button aria-label="Close review" onClick={() => setSelected(null)} className="crm-icon-button h-9 w-9 rounded-lg"><Icon name="close" /></button></div><audio controls src={selected.recordingUrl} className="mt-4 w-full" />{selected.analysisSummary ? <p className="mt-3 rounded-lg bg-[var(--crm-info-soft)] p-3 text-sm">{selected.analysisSummary}</p> : null}<div className="mt-4 space-y-4">{activeFramework.sections.map((section) => <fieldset key={section.label}><legend className="mb-2 text-sm font-black">{section.label}</legend><div className="grid gap-2 sm:grid-cols-2">{section.items.map((item) => <label key={item.id} className="flex items-start gap-2 rounded-lg border border-[var(--crm-border)] p-3 text-xs font-semibold"><input type="checkbox" checked={answers[item.id] === true} onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.checked }))} className="mt-0.5 accent-[var(--crm-brand)]" />{item.label}</label>)}</div></fieldset>)}</div><label className="mt-4 block text-xs font-black">Coaching note<textarea value={note} onChange={(event) => setNote(event.target.value)} className="crm-field mt-2 min-h-24 w-full rounded-lg p-3 text-sm font-normal" placeholder="What should the rep repeat or improve?" /></label><div className="mt-4 flex items-center justify-between"><span className="text-sm font-black">Score: {Math.round((Object.values(answers).filter(Boolean).length / activeFramework.sections.flatMap((section) => section.items).length) * 100)}%</span><button onClick={() => void save('complete', selected)} disabled={busy} className="crm-primary-button rounded-lg px-5 py-3 text-sm font-black">{busy ? 'Saving…' : 'Complete Review'}</button></div></section></div> : null}
    </main>
  )
}
