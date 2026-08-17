'use client'

import { useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type Protocol = 'sod' | 'eod'
type Submission = { id: string; submittedAt: string; checklist?: string[] } & Record<string, unknown>
type DailyState = { date: string; sod: Submission | null; eod: Submission | null }

const MORNING_STEPS = [
  { id: 'pipeline', title: 'Know the opportunities', detail: 'Review priority sellers and the next best action for each.' },
  { id: 'calendar', title: 'Protect the commitments', detail: 'Confirm appointments, callbacks, and time-sensitive follow-ups.' },
  { id: 'calling', title: 'Load the runway', detail: 'Open the right calling list and remove anything that should not be there.' },
  { id: 'practice', title: 'Sharpen one skill', detail: 'Practice the objection or framework moment most likely to matter today.' },
]

const EVENING_STEPS = [
  { id: 'dispositions', title: 'Every conversation has an outcome', detail: 'Calls and messages are dispositioned with accurate notes.' },
  { id: 'next-actions', title: 'Every live seller has a next action', detail: 'No opportunity is left depending on memory.' },
  { id: 'calendar', title: 'Tomorrow is ready', detail: 'Callbacks, appointments, and priority work are on the calendar.' },
  { id: 'inbox', title: 'Close the communication loop', detail: 'Urgent replies are handled or deliberately scheduled.' },
]

function displayName(email: string) {
  const local = email.split('@')[0] || 'Team member'
  return local.charAt(0).toUpperCase() + local.slice(1)
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function readText(submission: Submission | null, key: string) {
  return typeof submission?.[key] === 'string' ? submission[key] as string : ''
}

export function DailyRhythmWorkspace({ userEmail }: { userEmail: string }) {
  const [active, setActive] = useState<Protocol>('sod')
  const [daily, setDaily] = useState<DailyState | null>(null)
  const [checked, setChecked] = useState<Record<Protocol, string[]>>({ sod: [], eod: [] })
  const [focus, setFocus] = useState('')
  const [coachingCommitment, setCoachingCommitment] = useState('')
  const [energy, setEnergy] = useState(3)
  const [win, setWin] = useState('')
  const [lesson, setLesson] = useState('')
  const [tomorrow, setTomorrow] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const steps = active === 'sod' ? MORNING_STEPS : EVENING_STEPS
  const selected = checked[active]
  const completionCount = Number(Boolean(daily?.sod)) + Number(Boolean(daily?.eod))
  const dateLabel = useMemo(() => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric',
  }).format(new Date()), [])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/daily-rhythm', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Daily Rhythm could not load.')
        return payload as DailyState
      })
      .then((payload) => {
        if (cancelled) return
        setDaily(payload)
        setChecked({ sod: payload.sod?.checklist ?? [], eod: payload.eod?.checklist ?? [] })
        setFocus(readText(payload.sod, 'focus'))
        setCoachingCommitment(readText(payload.sod, 'coachingCommitment'))
        setEnergy(typeof payload.sod?.energy === 'number' ? payload.sod.energy : 3)
        setWin(readText(payload.eod, 'win'))
        setLesson(readText(payload.eod, 'lesson'))
        setTomorrow(readText(payload.eod, 'tomorrow'))
      })
      .catch((reason) => { if (!cancelled) setMessage(reason instanceof Error ? reason.message : 'Daily Rhythm could not load.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function toggleStep(id: string) {
    setChecked((current) => ({
      ...current,
      [active]: current[active].includes(id) ? current[active].filter((item) => item !== id) : [...current[active], id],
    }))
  }

  async function submit() {
    setSubmitting(true)
    setMessage(null)
    try {
      const response = await fetch('/api/daily-rhythm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocol: active, checklist: selected, focus, coachingCommitment, energy, win, lesson, tomorrow }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Daily Rhythm could not be saved.')
      const submission = { id: payload.id, submittedAt: payload.submittedAt, checklist: selected }
      setDaily((current) => ({ date: current?.date ?? '', sod: active === 'sod' ? submission : current?.sod ?? null, eod: active === 'eod' ? submission : current?.eod ?? null }))
      setMessage(active === 'sod' ? 'Morning Launch saved. Your day has a clear target.' : 'Daily Closeout saved. Tomorrow already has a first move.')
      if (active === 'sod') setActive('eod')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Daily Rhythm could not be saved.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-5 sm:px-6 lg:py-7">
      <header className="crm-panel overflow-hidden rounded-2xl">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_360px] lg:px-8">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--crm-brand)]">Daily operating rhythm</p>
            <h1 className="mt-1 text-[32px] font-black tracking-[-0.04em]">Win the day on purpose.</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-[var(--crm-text-muted)]">Launch with clarity. Close every loop. Leave tomorrow easier than you found today.</p>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className="rounded-full bg-[var(--crm-brand-soft)] px-3 py-1.5 text-[var(--crm-brand)]">{displayName(userEmail)}</span>
              <span className="text-[var(--crm-text-muted)]">{dateLabel}</span>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-5">
            <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">Today’s rhythm</span><span className="text-2xl font-black">{completionCount}/2</span></div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(['sod', 'eod'] as Protocol[]).map((protocol) => {
                const done = Boolean(daily?.[protocol])
                return <div key={protocol} className={cn('rounded-lg border p-3', done ? 'border-[var(--crm-success)] bg-[var(--crm-success-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface)]')}><Icon name={done ? 'check_circle' : protocol === 'sod' ? 'light_mode' : 'dark_mode'} className={cn('text-[20px]', done ? 'text-[var(--crm-success)]' : 'text-[var(--crm-text-muted)]')} /><p className="mt-1 text-xs font-black">{protocol === 'sod' ? 'Morning Launch' : 'Daily Closeout'}</p><p className="mt-0.5 text-[10px] text-[var(--crm-text-muted)]">{done ? `Saved ${formatTime(daily![protocol]!.submittedAt)}` : 'Not completed'}</p></div>
              })}
            </div>
          </div>
        </div>
      </header>

      <section className="crm-panel overflow-hidden rounded-2xl">
        <div className="flex border-b border-[var(--crm-border)] p-2">
          {(['sod', 'eod'] as Protocol[]).map((protocol) => <button key={protocol} type="button" onClick={() => { setActive(protocol); setMessage(null) }} className={cn('flex-1 rounded-lg px-4 py-3 text-sm font-black transition-colors', active === protocol ? 'bg-[var(--crm-brand)] text-white' : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]')}>{protocol === 'sod' ? 'Morning Launch' : 'Daily Closeout'}{daily?.[protocol] ? '  ✓' : ''}</button>)}
        </div>
        <div className="grid lg:grid-cols-[1fr_390px]">
          <div className="border-b border-[var(--crm-border)] p-5 lg:border-b-0 lg:border-r lg:p-7">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--crm-brand)]">{active === 'sod' ? 'Set the day before it sets you' : 'Finish clean'}</p>
            <h2 className="mt-1 text-2xl font-black tracking-[-0.03em]">{active === 'sod' ? 'Build the runway' : 'Close the loops'}</h2>
            <div className="mt-5 space-y-2">
              {steps.map((step) => {
                const done = selected.includes(step.id)
                return <button key={step.id} type="button" disabled={loading} onClick={() => toggleStep(step.id)} aria-pressed={done} className={cn('flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-wait disabled:opacity-60', done ? 'border-[var(--crm-success)] bg-[var(--crm-success-soft)]' : 'border-[var(--crm-border)] hover:border-[var(--crm-brand-border)] hover:bg-[var(--crm-surface-subtle)]')}><span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2', done ? 'border-[var(--crm-success)] bg-[var(--crm-success)] text-white' : 'border-[var(--crm-border-strong)]')}><Icon name={done ? 'check' : 'circle'} className="text-[15px]" /></span><span><strong className="block text-sm">{step.title}</strong><span className="mt-0.5 block text-xs leading-5 text-[var(--crm-text-muted)]">{step.detail}</span></span></button>
              })}
            </div>
          </div>

          <div className="bg-[var(--crm-surface-subtle)] p-5 lg:p-7">
            {active === 'sod' ? <>
              <label className="block text-xs font-black">What outcome makes today a win?<textarea value={focus} onChange={(event) => setFocus(event.target.value)} rows={3} placeholder="One clear, measurable outcome…" className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 text-sm font-medium outline-none focus:border-[var(--crm-brand)]" /></label>
              <label className="mt-5 block text-xs font-black">One skill commitment<textarea value={coachingCommitment} onChange={(event) => setCoachingCommitment(event.target.value)} rows={2} placeholder="Example: ask one question deeper before moving on." className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 text-sm font-medium outline-none focus:border-[var(--crm-brand)]" /></label>
              <fieldset className="mt-5"><legend className="text-xs font-black">Starting energy</legend><div className="mt-2 grid grid-cols-5 gap-2">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" onClick={() => setEnergy(value)} aria-pressed={energy === value} className={cn('rounded-lg border py-2 text-xs font-black', energy === value ? 'border-[var(--crm-brand)] bg-[var(--crm-brand)] text-white' : 'border-[var(--crm-border)] bg-[var(--crm-surface)]')}>{value}</button>)}</div></fieldset>
            </> : <>
              <label className="block text-xs font-black">Today’s win<textarea value={win} onChange={(event) => setWin(event.target.value)} rows={2} placeholder="What moved forward today?" className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 text-sm font-medium outline-none focus:border-[var(--crm-brand)]" /></label>
              <label className="mt-4 block text-xs font-black">Lesson worth carrying<textarea value={lesson} onChange={(event) => setLesson(event.target.value)} rows={2} placeholder="What will you repeat or change?" className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 text-sm font-medium outline-none focus:border-[var(--crm-brand)]" /></label>
              <label className="mt-4 block text-xs font-black">Tomorrow’s first move<textarea value={tomorrow} onChange={(event) => setTomorrow(event.target.value)} rows={2} placeholder="The first action that removes uncertainty tomorrow…" className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 text-sm font-medium outline-none focus:border-[var(--crm-brand)]" /></label>
            </>}
            <button type="button" disabled={submitting || loading || selected.length === 0} onClick={submit} className="crm-primary-button mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-45"><Icon name={daily?.[active] ? 'refresh' : 'check_circle'} className="text-[18px]" />{submitting ? 'Saving…' : daily?.[active] ? 'Update rhythm' : active === 'sod' ? 'Launch my day' : 'Close my day'}</button>
            {message ? <p role="status" className="mt-3 text-center text-xs font-bold text-[var(--crm-text-muted)]">{message}</p> : null}
          </div>
        </div>
      </section>
    </main>
  )
}
