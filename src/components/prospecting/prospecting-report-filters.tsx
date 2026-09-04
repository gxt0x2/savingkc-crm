'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useRef, useState, useTransition } from 'react'
import { formatPhone } from '@/lib/format'
import { resolveMyDayDateRange, type MyDayDateRange, type MyDayRangePreset, type MyDayRangeRequest } from '@/lib/my-day-range'
import { cn } from '@/lib/utils'

type CampaignOption = { id: string; name: string }
type RunOption = { runNumber: number }

const RANGE_CHOICES: Array<{ preset: Exclude<MyDayRangePreset, 'custom'>; label: string; description: string }> = [
  { preset: 'today', label: 'Today', description: 'Current day' },
  { preset: 'yesterday', label: 'Yesterday', description: 'Previous day' },
  { preset: 'this_week', label: 'This week', description: 'Monday through today' },
  { preset: 'last_week', label: 'Last week', description: 'Previous calendar week' },
  { preset: 'last_7_days', label: 'Last 7 days', description: 'Rolling seven-day window' },
  { preset: 'month_to_date', label: 'Month to date', description: 'First of month through today' },
  { preset: 'previous_month', label: 'Previous month', description: 'Full prior calendar month' },
  { preset: 'last_30_days', label: 'Last 30 days', description: 'Rolling thirty-day window' },
]

function compactDates(range: MyDayDateRange) {
  const format = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  if (range.from === range.to) return format.format(new Date(`${range.from}T12:00:00Z`))
  return `${format.format(new Date(`${range.from}T12:00:00Z`))} – ${format.format(new Date(`${range.to}T12:00:00Z`))}`
}

function reportUrl(campaignId: string, runNumber: string, range: MyDayDateRange, agentEmail: string, callerId: string, view: string, sort: string, direction: string) {
  const query = new URLSearchParams({ campaign: campaignId, range: range.preset })
  if (campaignId !== 'all' && runNumber) query.set('run', runNumber)
  if (agentEmail) query.set('agent', agentEmail)
  if (callerId) query.set('caller', callerId)
  if (view !== 'calls') query.set('view', view)
  if (sort !== 'called') query.set('sort', sort)
  if (direction !== 'desc') query.set('dir', direction)
  if (range.preset === 'custom') {
    query.set('from', range.from)
    query.set('to', range.to)
  }
  return `/prospecting/reports?${query.toString()}`
}

export function ProspectingReportFilters({
  campaigns,
  campaignId,
  runNumber,
  runs,
  agents,
  callerIds,
  agentEmail,
  callerId,
  range,
  today,
  view,
  sort,
  direction,
}: {
  campaigns: CampaignOption[]
  campaignId: string | null
  runNumber: number | null
  runs: RunOption[]
  agents: Array<{ email: string; name: string }>
  callerIds: string[]
  agentEmail: string | null
  callerId: string | null
  range: MyDayDateRange
  today: string
  view: string
  sort: string
  direction: string
}) {
  const router = useRouter()
  const [selectedCampaign, setSelectedCampaign] = useState(campaignId || 'all')
  const [selectedRun, setSelectedRun] = useState(runNumber ? String(runNumber) : '')
  const [selectedAgent, setSelectedAgent] = useState(agentEmail || '')
  const [selectedCallerId, setSelectedCallerId] = useState(callerId || '')
  const [selectedRange, setSelectedRange] = useState(range)
  const [rangeOpen, setRangeOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(range.from)
  const [customTo, setCustomTo] = useState(range.to)
  const [pending, startTransition] = useTransition()
  const rangeContainer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rangeOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rangeContainer.current?.contains(event.target as Node)) setRangeOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRangeOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [rangeOpen])

  function navigate(nextRange = selectedRange) {
    startTransition(() => router.push(reportUrl(selectedCampaign, selectedRun, nextRange, selectedAgent, selectedCallerId, view, sort, direction), { scroll: false }))
  }

  function applyRange(request: MyDayRangeRequest) {
    const nextRange = resolveMyDayDateRange(request, new Date(`${today}T12:00:00Z`))
    setSelectedRange(nextRange)
    setRangeOpen(false)
    navigate(nextRange)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    navigate()
  }

  const customInvalid = !customFrom || !customTo || customFrom > customTo || customTo > today

  return (
    <form onSubmit={submit} className="crm-panel grid gap-3 rounded-2xl p-4 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.2fr)_minmax(9rem,0.65fr)_minmax(11rem,0.9fr)_minmax(11rem,0.9fr)_minmax(13rem,1fr)_auto] xl:items-end">
      <label className="text-xs font-black text-[var(--crm-ink)]">Campaign
        <select name="campaign" aria-label="Report campaign" value={selectedCampaign} onChange={(event) => { setSelectedCampaign(event.target.value); setSelectedRun(''); setSelectedAgent(''); setSelectedCallerId('') }} className="crm-field mt-1.5 h-12 w-full rounded-xl px-3 text-sm font-bold">
          <option value="all">All campaigns</option>
          {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
        </select>
      </label>
      <label className="text-xs font-black text-[var(--crm-ink)]">Campaign run
        <select name="run" aria-label="Campaign run" value={selectedRun} onChange={(event) => setSelectedRun(event.target.value)} disabled={selectedCampaign === 'all'} className="crm-field mt-1.5 h-12 w-full rounded-xl px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-55">
          <option value="">All runs</option>
          {runs.map((run) => <option key={run.runNumber} value={run.runNumber}>Run {run.runNumber}</option>)}
        </select>
      </label>
      <label className="text-xs font-black text-[var(--crm-ink)]">Agent
        <select name="agent" aria-label="Report agent" value={selectedAgent} onChange={(event) => setSelectedAgent(event.target.value)} className="crm-field mt-1.5 h-12 w-full rounded-xl px-3 text-sm font-bold">
          <option value="">All agents</option>
          {agents.map((agent) => <option key={agent.email} value={agent.email}>{agent.name}</option>)}
        </select>
      </label>
      <label className="text-xs font-black text-[var(--crm-ink)]">Caller ID
        <select name="caller" aria-label="Report caller ID" value={selectedCallerId} onChange={(event) => setSelectedCallerId(event.target.value)} className="crm-field mt-1.5 h-12 w-full rounded-xl px-3 text-sm font-bold">
          <option value="">All caller IDs</option>
          {callerIds.map((number) => <option key={number} value={number}>{formatPhone(number)}</option>)}
        </select>
      </label>
      <div ref={rangeContainer} className="relative">
        <span className="text-xs font-black text-[var(--crm-ink)]">Time range</span>
        <button type="button" aria-haspopup="dialog" aria-expanded={rangeOpen} aria-label={`Date range: ${selectedRange.label}`} onClick={() => { setCustomFrom(selectedRange.from); setCustomTo(selectedRange.to); setRangeOpen((open) => !open) }} className="crm-field mt-1.5 flex h-12 w-full min-w-[210px] items-center gap-3 rounded-xl px-3 text-left">
          <span className="min-w-0 flex-1"><strong className="block truncate text-[12px] font-black">{selectedRange.label}</strong><span className="block truncate text-[10px] font-semibold text-[var(--crm-text-muted)]">{compactDates(selectedRange)}</span></span>
          <span aria-hidden="true" className="text-base leading-none text-[var(--crm-text-muted)]">{rangeOpen ? '⌃' : '⌄'}</span>
        </button>
        {rangeOpen ? <div role="dialog" aria-label="Choose reporting date range" className="absolute right-0 z-50 mt-2 grid w-[min(640px,calc(100vw-2rem))] gap-4 rounded-2xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] p-4 shadow-2xl sm:grid-cols-[1.1fr_0.9fr]">
          <section aria-labelledby="prospecting-quick-ranges-title">
            <h2 id="prospecting-quick-ranges-title" className="px-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">Quick ranges</h2>
            <div className="mt-2 grid grid-cols-2 gap-1">{RANGE_CHOICES.map((choice) => {
              const active = selectedRange.preset === choice.preset
              return <button key={choice.preset} type="button" aria-pressed={active} onClick={() => applyRange({ preset: choice.preset })} className={cn('rounded-xl border px-3 py-2.5 text-left transition', active ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'border-transparent hover:border-[var(--crm-border)] hover:bg-[var(--crm-surface-subtle)]')}><span className="flex items-center justify-between gap-2 text-[12px] font-black">{choice.label}{active ? <span aria-hidden="true">✓</span> : null}</span><span className="mt-0.5 block text-[9px] font-semibold text-[var(--crm-text-muted)]">{choice.description}</span></button>
            })}</div>
          </section>
          <section aria-labelledby="prospecting-custom-range-title" className="rounded-xl bg-[var(--crm-surface-subtle)] p-3">
            <h2 id="prospecting-custom-range-title" className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">Custom range</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--crm-text-muted)]">Choose up to 90 days. Future dates are unavailable.</p>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-[10px] font-black text-[var(--crm-text-muted)]">From<input aria-label="Custom range start" type="date" value={customFrom} max={today} onChange={(event) => setCustomFrom(event.target.value)} className="crm-field h-10 rounded-lg px-3 text-xs font-bold" /></label>
              <label className="grid gap-1 text-[10px] font-black text-[var(--crm-text-muted)]">To<input aria-label="Custom range end" type="date" value={customTo} min={customFrom || undefined} max={today} onChange={(event) => setCustomTo(event.target.value)} className="crm-field h-10 rounded-lg px-3 text-xs font-bold" /></label>
            </div>
            <button type="button" disabled={customInvalid} onClick={() => applyRange({ preset: 'custom', from: customFrom, to: customTo })} className="crm-primary-button mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-xs font-black disabled:cursor-not-allowed disabled:opacity-45">Apply custom range</button>
          </section>
        </div> : null}
      </div>
      <button type="submit" disabled={pending} className="crm-primary-button h-12 rounded-xl px-5 text-sm font-black disabled:opacity-60">{pending ? 'Applying…' : 'Apply'}</button>
    </form>
  )
}
