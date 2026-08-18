'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type Protocol = 'sod' | 'eod'
type Submission = { id: string; submittedAt: string; checklist?: string[] } & Record<string, unknown>
type DailyState = {
  date: string
  sod: Submission | null
  eod: Submission | null
  purpose?: { personalGoal?: string; personalWhy?: string; updatedAt?: string | null }
}
type HubThread = { attentionState?: string; lastChannel?: string | null; primaryNextAction?: { overdue?: boolean } | null }
type QueueItem = {
  id: string
  leadId: string | null
  leadName: string
  property: string
  stage: string
  priority: 'High' | 'Medium' | 'Low'
  action: 'Call' | 'SMS' | 'Open'
  dueAt: string | null
}
type MyDay = { commitments?: unknown[]; queue?: QueueItem[] }

const MORNING_STEPS = [
  { id: 'purpose', title: 'Your Goal & Why', detail: 'Remember what you are working toward.' },
  { id: 'urgent', title: 'Clear Urgent Messages', detail: 'Review missed calls, emails, texts, and overdue replies.' },
  { id: 'calendar', title: 'Confirm Today', detail: 'Check appointments, callbacks, and meetings.' },
  { id: 'pipeline', title: 'Review Priority Sellers', detail: 'Know the next action for every priority seller.' },
  { id: 'calling', title: 'Ready the Call List', detail: 'Start with the right people in the right order.' },
  { id: 'commit', title: 'Set Today’s Goal', detail: 'Choose the result that makes today successful.' },
] as const

const EVENING_STEPS = [
  { id: 'dispositions', title: 'Log Every Outcome', detail: 'Update calls, messages, and notes.' },
  { id: 'next-actions', title: 'Set Next Actions', detail: 'Every active seller has a clear next step.' },
  { id: 'calendar', title: 'Plan Tomorrow', detail: 'Schedule callbacks and priority work.' },
  { id: 'inbox', title: 'Clear Urgent Replies', detail: 'Reply now or schedule the response.' },
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
  const [wizardStep, setWizardStep] = useState(0)
  const [personalGoal, setPersonalGoal] = useState('')
  const [personalWhy, setPersonalWhy] = useState('')
  const [focus, setFocus] = useState('')
  const [energy, setEnergy] = useState(3)
  const [win, setWin] = useState('')
  const [lesson, setLesson] = useState('')
  const [tomorrow, setTomorrow] = useState('')
  const [hubThreads, setHubThreads] = useState<HubThread[]>([])
  const [myDay, setMyDay] = useState<MyDay>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const completionCount = Number(Boolean(daily?.sod)) + Number(Boolean(daily?.eod))
  const teamMemberName = displayName(userEmail)
  const dateLabel = useMemo(() => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric',
  }).format(new Date()), [])
  const needsReply = hubThreads.filter((thread) => thread.attentionState === 'needs_reply')
  const urgentCounts = {
    calls: needsReply.filter((thread) => ['call', 'voicemail'].includes(thread.lastChannel ?? '')).length,
    emails: needsReply.filter((thread) => thread.lastChannel === 'email').length,
    texts: needsReply.filter((thread) => thread.lastChannel === 'sms').length,
    overdue: hubThreads.filter((thread) => thread.primaryNextAction?.overdue).length,
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      fetch('/api/daily-rhythm', { cache: 'no-store' }).then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Daily Rhythm could not load.')
        return payload as DailyState
      }),
      fetch('/api/my-day', { cache: 'no-store' }).then((response) => response.ok ? response.json() as Promise<MyDay> : {}),
      fetch('/api/conversations/hub', { cache: 'no-store' }).then(async (response) => response.ok ? (await response.json()).items as HubThread[] : []),
    ]).then(([payload, myDayPayload, threads]) => {
      if (cancelled) return
      setDaily(payload)
      setMyDay(myDayPayload)
      setHubThreads(Array.isArray(threads) ? threads : [])
      setChecked({ sod: payload.sod?.checklist ?? [], eod: payload.eod?.checklist ?? [] })
      setPersonalGoal(readText(payload.sod, 'personalGoal') || payload.purpose?.personalGoal || '')
      setPersonalWhy(readText(payload.sod, 'personalWhy') || payload.purpose?.personalWhy || '')
      setFocus(readText(payload.sod, 'focus'))
      setEnergy(typeof payload.sod?.energy === 'number' ? payload.sod.energy : 3)
      setWin(readText(payload.eod, 'win'))
      setLesson(readText(payload.eod, 'lesson'))
      setTomorrow(readText(payload.eod, 'tomorrow'))
    }).catch((reason) => { if (!cancelled) setMessage(reason instanceof Error ? reason.message : 'Daily Rhythm could not load.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function completeMorningStep() {
    const id = MORNING_STEPS[wizardStep].id
    setChecked((current) => ({ ...current, sod: current.sod.includes(id) ? current.sod : [...current.sod, id] }))
    if (wizardStep < MORNING_STEPS.length - 1) setWizardStep((current) => current + 1)
  }

  function toggleEveningStep(id: string) {
    setChecked((current) => ({ ...current, eod: current.eod.includes(id) ? current.eod.filter((item) => item !== id) : [...current.eod, id] }))
  }

  async function submit(protocol: Protocol, checklist = checked[protocol]) {
    setSubmitting(true)
    setMessage(null)
    try {
      const response = await fetch('/api/daily-rhythm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocol, checklist, personalGoal, personalWhy, focus, energy, win, lesson, tomorrow }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Daily Rhythm could not be saved.')
      const submission = { id: payload.id, submittedAt: payload.submittedAt, checklist }
      setDaily((current) => ({ date: current?.date ?? '', sod: protocol === 'sod' ? submission : current?.sod ?? null, eod: protocol === 'eod' ? submission : current?.eod ?? null }))
      setMessage(protocol === 'sod' ? 'Your day is ready. Open My Day and start with the first priority.' : 'Daily Closeout saved. Tomorrow already has a first move.')
      if (protocol === 'sod') setActive('eod')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Daily Rhythm could not be saved.')
    } finally { setSubmitting(false) }
  }

  const step = MORNING_STEPS[wizardStep]
  const canContinue = step.id !== 'purpose' || Boolean(personalGoal.trim() && personalWhy.trim())

  return <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-5 sm:px-6 lg:py-7">
    <header className="relative overflow-hidden rounded-2xl border border-[var(--crm-border)] bg-[#f6f8f7] shadow-sm">
      <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center opacity-40" style={{ backgroundImage: "url('/kc-skyline.jpg')" }} />
      <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgba(249,250,249,0.98)_0%,rgba(249,250,249,0.88)_48%,rgba(226,237,234,0.72)_100%)]" />
      <div className="relative grid gap-6 px-6 py-8 text-[#151719] lg:grid-cols-[1fr_360px] lg:px-8 lg:py-10">
        <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#cf2029]">Daily Rhythm · Kansas City</p><h1 className="mt-2 max-w-2xl text-[36px] font-black leading-[1.02] tracking-[-0.05em]">Let’s make today count, <span className="text-[#cf2029]">{teamMemberName}.</span></h1><p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-[#52575c]">Start with purpose, protect the important work, and finish with nothing left hanging.</p><div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#bfe4d2] bg-[#eefaf4] px-3 py-1.5 text-xs font-black text-[#11884c]"><Icon name="bolt" className="text-[16px]" />One focused step at a time.</div><div className="mt-4 flex gap-2 text-xs font-bold"><span className="rounded-full border border-[#d7dbdd] bg-white/80 px-3 py-1.5">{teamMemberName}</span><span className="py-1.5 text-[#60656a]">{dateLabel}</span></div></div>
        <div className="rounded-xl border border-white/80 bg-white/85 p-5 shadow-[0_16px_45px_rgba(40,65,60,0.12)] backdrop-blur-sm"><div className="flex items-center justify-between"><span className="text-xs font-black uppercase text-[#60656a]">Today’s rhythm</span><span className="text-2xl font-black">{completionCount}/2</span></div><div className="mt-4 grid grid-cols-2 gap-2">{(['sod', 'eod'] as Protocol[]).map((protocol) => { const done = Boolean(daily?.[protocol]); return <div key={protocol} className={cn('rounded-lg border p-3', done ? 'border-[#bfe4d2] bg-[#eefaf4]' : 'border-[#dfe3e5] bg-white/90')}><Icon name={done ? 'check_circle' : protocol === 'sod' ? 'light_mode' : 'dark_mode'} className={cn('text-[20px]', done ? 'text-[#11884c]' : 'text-[#62686d]')} /><p className="mt-1 text-xs font-black">{protocol === 'sod' ? 'Morning Launch' : 'Daily Closeout'}</p><p className="mt-0.5 text-[10px] text-[#6b7075]">{done ? `Saved ${formatTime(daily![protocol]!.submittedAt)}` : 'Not completed'}</p></div> })}</div></div>
      </div>
    </header>

    <section className="crm-panel overflow-hidden rounded-2xl">
      <div className="flex border-b border-[var(--crm-border)] p-2">{(['sod', 'eod'] as Protocol[]).map((protocol) => <button key={protocol} type="button" onClick={() => { setActive(protocol); setMessage(null) }} className={cn('flex-1 rounded-lg px-4 py-3 text-sm font-black', active === protocol ? 'bg-[var(--crm-brand)] text-white' : 'text-[var(--crm-text-muted)]')}>{protocol === 'sod' ? 'Morning Launch' : 'Daily Closeout'}{daily?.[protocol] ? '  ✓' : ''}</button>)}</div>
      {active === 'sod' ? <div className="grid min-h-[500px] lg:grid-cols-[270px_1fr]">
        <aside className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-5 lg:border-b-0 lg:border-r"><p className="text-[10px] font-black uppercase tracking-widest text-[var(--crm-brand)]">Morning setup</p><p className="mt-1 text-sm font-bold">Step {wizardStep + 1} of {MORNING_STEPS.length}</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--crm-border)]"><div className="h-full rounded-full bg-[var(--crm-brand)] transition-all" style={{ width: `${((wizardStep + 1) / MORNING_STEPS.length) * 100}%` }} /></div><nav className="mt-5 space-y-1">{MORNING_STEPS.map((item, index) => <button key={item.id} type="button" onClick={() => setWizardStep(index)} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold', index === wizardStep ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'text-[var(--crm-text-muted)]')}><Icon name={checked.sod.includes(item.id) ? 'check_circle' : 'radio_button_unchecked'} className="text-[18px]" />{item.title}</button>)}</nav></aside>
        <div className="flex flex-col p-6 lg:p-8"><div className="flex-1"><p className="text-[10px] font-black uppercase tracking-widest text-[var(--crm-brand)]">{String(wizardStep + 1).padStart(2, '0')}</p><h2 className="mt-1 text-2xl font-black tracking-tight">{step.title}</h2><p className="mt-1 text-sm text-[var(--crm-text-muted)]">{step.detail}</p><div className="mt-6 max-w-2xl">
          {step.id === 'purpose' ? <div className="grid gap-5"><label className="text-xs font-black">Personal goal<textarea value={personalGoal} onChange={(event) => setPersonalGoal(event.target.value)} rows={3} placeholder="What are you working toward personally?" className="crm-field mt-2 w-full rounded-lg p-3 text-sm font-medium" /></label><label className="text-xs font-black">Your why<textarea value={personalWhy} onChange={(event) => setPersonalWhy(event.target.value)} rows={3} placeholder="Why does this matter to you?" className="crm-field mt-2 w-full rounded-lg p-3 text-sm font-medium" /></label><fieldset><legend className="text-xs font-black">Energy level</legend><div className="mt-2 grid max-w-sm grid-cols-5 gap-2">{[1,2,3,4,5].map((value) => <button key={value} type="button" onClick={() => setEnergy(value)} className={cn('rounded-lg border py-2 text-xs font-black', energy === value ? 'border-[var(--crm-brand)] bg-[var(--crm-brand)] text-white' : 'border-[var(--crm-border)]')}>{value}</button>)}</div></fieldset></div> : null}
          {step.id === 'urgent' ? <div className="grid gap-3 sm:grid-cols-2">{[['missed_call','Missed calls',urgentCounts.calls],['mail','Emails',urgentCounts.emails],['sms','Texts',urgentCounts.texts],['schedule','Overdue actions',urgentCounts.overdue]].map(([icon,label,value]) => <div key={String(label)} className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4"><Icon name={String(icon)} className="text-[22px] text-[var(--crm-brand)]" /><p className="mt-2 text-2xl font-black">{loading ? '—' : String(value)}</p><p className="text-xs font-bold text-[var(--crm-text-muted)]">{label}</p></div>)}<Link href="/conversations" className="crm-secondary-button col-span-full rounded-lg px-4 py-3 text-center text-xs font-black">Open Conversations</Link></div> : null}
          {step.id === 'calendar' ? <SummaryCard icon="calendar_month" value={myDay.commitments?.length ?? 0} label="commitments scheduled" href="/calendar" action="Review calendar" /> : null}
          {step.id === 'pipeline' ? <PriorityPreview items={myDay.queue ?? []} /> : null}
          {step.id === 'calling' ? <SummaryCard icon="dialpad" value={myDay.queue?.length ?? 0} label="people ready for action" href="/dialer" action="Open Dialer" /> : null}
          {step.id === 'commit' ? <label className="block text-xs font-black">Today’s main goal<textarea value={focus} onChange={(event) => setFocus(event.target.value)} rows={4} placeholder="What must happen today?" className="crm-field mt-2 w-full rounded-lg p-3 text-sm font-medium" /></label> : null}
        </div></div><div className="mt-8 flex items-center justify-between border-t border-[var(--crm-border)] pt-5"><button type="button" disabled={wizardStep === 0} onClick={() => setWizardStep((current) => current - 1)} className="crm-secondary-button rounded-lg px-4 py-2 text-xs font-black disabled:opacity-30">Back</button>{wizardStep < MORNING_STEPS.length - 1 ? <button type="button" disabled={!canContinue || loading} onClick={completeMorningStep} className="crm-primary-button rounded-lg px-5 py-2.5 text-xs font-black disabled:opacity-40">Continue</button> : <button type="button" disabled={submitting || !focus.trim()} onClick={() => { const checklist = checked.sod.includes('commit') ? checked.sod : [...checked.sod, 'commit']; setChecked((current) => ({ ...current, sod: checklist })); void submit('sod', checklist) }} className="crm-primary-button rounded-lg px-5 py-2.5 text-xs font-black disabled:opacity-40">{submitting ? 'Saving…' : 'Start My Day'}</button>}</div></div>
      </div> : <div className="grid lg:grid-cols-[1fr_390px]"><div className="border-b border-[var(--crm-border)] p-6 lg:border-b-0 lg:border-r"><h2 className="text-2xl font-black">Close the day</h2><div className="mt-5 space-y-2">{EVENING_STEPS.map((item) => { const done = checked.eod.includes(item.id); return <button key={item.id} type="button" onClick={() => toggleEveningStep(item.id)} className={cn('flex w-full items-start gap-3 rounded-xl border p-4 text-left', done ? 'border-[var(--crm-success)] bg-[var(--crm-success-soft)]' : 'border-[var(--crm-border)]')}><Icon name={done ? 'check_circle' : 'radio_button_unchecked'} className={done ? 'text-[var(--crm-success)]' : ''} /><span><strong className="block text-sm">{item.title}</strong><span className="text-xs text-[var(--crm-text-muted)]">{item.detail}</span></span></button> })}</div></div><div className="bg-[var(--crm-surface-subtle)] p-6"><label className="block text-xs font-black">Today’s win<textarea value={win} onChange={(event) => setWin(event.target.value)} rows={2} className="crm-field mt-2 w-full rounded-lg p-3 text-sm" /></label><label className="mt-4 block text-xs font-black">What did you learn?<textarea value={lesson} onChange={(event) => setLesson(event.target.value)} rows={2} className="crm-field mt-2 w-full rounded-lg p-3 text-sm" /></label><label className="mt-4 block text-xs font-black">First move tomorrow<textarea value={tomorrow} onChange={(event) => setTomorrow(event.target.value)} rows={2} className="crm-field mt-2 w-full rounded-lg p-3 text-sm" /></label><button type="button" disabled={submitting || checked.eod.length === 0} onClick={() => void submit('eod')} className="crm-primary-button mt-6 w-full rounded-lg px-4 py-3 text-sm font-black disabled:opacity-40">Close My Day</button></div></div>}
      {message ? <p role="status" className="border-t border-[var(--crm-border)] px-6 py-3 text-center text-xs font-bold text-[var(--crm-text-muted)]">{message}</p> : null}
    </section>
  </main>
}

function SummaryCard({ icon, value, label, href, action }: { icon: string; value: number; label: string; href: string; action: string }) {
  return <div className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-5"><Icon name={icon} className="text-2xl text-[var(--crm-brand)]" /><p className="mt-3 text-3xl font-black">{value}</p><p className="text-sm font-bold text-[var(--crm-text-muted)]">{label}</p><Link href={href} className="crm-secondary-button mt-5 inline-flex rounded-lg px-4 py-2 text-xs font-black">{action}</Link></div>
}

function PriorityPreview({ items }: { items: QueueItem[] }) {
  const preview = items.slice(0, 4)
  return <div className="overflow-hidden rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]">
    <div className="flex items-center justify-between border-b border-[var(--crm-border)] px-4 py-3"><div><p className="text-sm font-black">Top {items.length} priority actions</p><p className="text-[11px] text-[var(--crm-text-muted)]">Sorted by priority, then due date.</p></div><Icon name="conversion_path" className="text-xl text-[var(--crm-brand)]" /></div>
    {preview.length > 0 ? <div className="divide-y divide-[var(--crm-border)]">{preview.map((item) => <Link key={item.id} href={item.leadId ? `/leads/${item.leadId}` : '/contacts?list=new'} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 hover:bg-[var(--crm-surface)]"><span className="min-w-0"><strong className="block truncate text-xs">{item.leadName}</strong><span className="mt-0.5 block truncate text-[10px] text-[var(--crm-text-muted)]">{item.property} · {item.stage}</span></span><span className="flex items-center gap-2"><span className={cn('rounded-full px-2 py-1 text-[9px] font-black', item.priority === 'High' ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'bg-[var(--crm-surface)] text-[var(--crm-text-muted)]')}>{item.priority}</span><span className="text-[10px] font-black text-[var(--crm-brand)]">{item.action}</span></span></Link>)}</div> : <p className="px-4 py-6 text-center text-xs font-bold text-[var(--crm-text-muted)]">No priority actions are waiting.</p>}
    <div className="flex items-center justify-between border-t border-[var(--crm-border)] px-4 py-3"><span className="text-[10px] font-bold text-[var(--crm-text-muted)]">{items.length > preview.length ? `+${items.length - preview.length} more in today’s queue` : 'Full list ready'}</span><Link href="/contacts?list=new" className="crm-secondary-button rounded-lg px-3 py-2 text-[10px] font-black">Open Pipeline</Link></div>
  </div>
}
