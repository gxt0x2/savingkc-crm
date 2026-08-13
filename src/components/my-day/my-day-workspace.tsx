'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { MY_DAY_TIME_ZONE, type MyDayData, type MyDayMetric, type MyDayQueueItem } from '@/lib/my-day'
import { cn } from '@/lib/utils'

const TONE_STYLES: Record<MyDayMetric['tone'], { icon: string; text: string; dot: string; soft: string }> = {
  blue: { icon: 'text-[#2563eb]', text: 'text-[#2563eb]', dot: 'bg-[#2563eb]', soft: 'bg-[#eaf2ff]' },
  violet: { icon: 'text-[#6d28d9]', text: 'text-[#6d28d9]', dot: 'bg-[#6d28d9]', soft: 'bg-[#f1ebff]' },
  coral: { icon: 'text-[#f05a28]', text: 'text-[#f05a28]', dot: 'bg-[#f05a28]', soft: 'bg-[#fff0ea]' },
  sky: { icon: 'text-[#0f6fe8]', text: 'text-[#0f6fe8]', dot: 'bg-[#0f6fe8]', soft: 'bg-[#eaf4ff]' },
  green: { icon: 'text-[#07883f]', text: 'text-[#07883f]', dot: 'bg-[#07883f]', soft: 'bg-[#eaf7ef]' },
  indigo: { icon: 'text-[#175cd3]', text: 'text-[#175cd3]', dot: 'bg-[#175cd3]', soft: 'bg-[#edf3ff]' },
}

const PRIORITY_STYLES: Record<MyDayQueueItem['priority'], string> = {
  High: 'border-[#ffd4d0] bg-[#fff0ef] text-[#c13229]',
  Medium: 'border-[#ffe0a8] bg-[#fff7e7] text-[#9a5b00]',
  Low: 'border-[#bfe7d0] bg-[#edf9f2] text-[#08753f]',
}

const STAGE_STYLES: Record<string, string> = {
  New: 'border-[#c7dcff] bg-[#edf4ff] text-[#225eb8]',
  Leads: 'border-[#c7dcff] bg-[#edf4ff] text-[#225eb8]',
  Contacted: 'border-[#c7dcff] bg-[#edf4ff] text-[#225eb8]',
  Opportunity: 'border-[#d7c7fb] bg-[#f4efff] text-[#6d28d9]',
  'Appointment Set': 'border-[#bfe7d0] bg-[#edf9f2] text-[#08753f]',
  'Offer Made': 'border-[#ffd7c1] bg-[#fff3eb] text-[#b84b14]',
  'Under Contract': 'border-[#bfe7d0] bg-[#edf9f2] text-[#08753f]',
}

function greeting(generatedAt: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MY_DAY_TIME_ZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(generatedAt))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 12)
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function monthOptions(currentMonth: string) {
  const anchor = new Date(`${currentMonth}-15T12:00:00Z`)
  return Array.from({ length: 18 }, (_, index) => {
    const date = new Date(anchor)
    date.setUTCMonth(anchor.getUTCMonth() - index)
    const value = date.toISOString().slice(0, 7)
    const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
    return { value, label }
  })
}

function formatDateTime(value: string | null, mode: 'time' | 'due', referenceAt: string) {
  if (!value) return mode === 'due' ? 'No due date' : 'Time not set'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Date unavailable'
  if (mode === 'time') {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MY_DAY_TIME_ZONE,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }

  const now = new Date(referenceAt)
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: MY_DAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
  const today = dateKey.format(now)
  const tomorrowDate = new Date(now.getTime() + 86_400_000)
  const tomorrow = dateKey.format(tomorrowDate)
  const target = dateKey.format(date)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: MY_DAY_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(date)
  if (target === today) return `Today ${time}`
  if (target === tomorrow) return `Tomorrow ${time}`
  return new Intl.DateTimeFormat('en-US', { timeZone: MY_DAY_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

function metricValue(value: number | null) {
  return value === null ? '—' : value.toLocaleString()
}

function habitValue(value: number | null) {
  return value === null ? '—' : `${value}%`
}

function FunnelCard({ metrics }: { metrics: MyDayMetric[] }) {
  return (
    <section aria-labelledby="conversion-funnel-title" className="crm-panel rounded-xl px-4 py-3 sm:px-5">
      <h2 id="conversion-funnel-title" className="text-[15px] font-black">Conversion Funnel</h2>
      <div className="mt-2 overflow-x-auto">
        <div className="grid min-w-[900px] grid-cols-6 lg:min-w-0">
          {metrics.map((metric, index) => {
          const tone = TONE_STYLES[metric.tone]
          return (
            <div key={metric.key} className="relative min-w-0 px-2 first:pl-0 last:pr-0">
              <div className="flex min-h-[74px] items-center gap-2.5">
                <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', tone.soft)}>
                  <Icon name={metric.icon} className={cn('text-[25px]', tone.icon)} />
                </div>
                <div className="min-w-0">
                  <p className="max-w-[94px] text-[10px] font-extrabold leading-[1.25] text-[var(--crm-text)]">{metric.label}</p>
                  <p className="mt-1 text-[24px] font-black leading-none">{metricValue(metric.value)}</p>
                </div>
                {index < metrics.length - 1 ? <Icon name="chevron_right" className="ml-auto shrink-0 text-[20px] text-[var(--crm-text-dim)]" /> : null}
              </div>
              <div className="relative mt-1 h-3 border-t border-dashed border-[var(--crm-border-strong)]">
                <span className={cn('absolute -top-[4px] left-6 h-2 w-2 rounded-full ring-4 ring-[var(--crm-surface)]', tone.dot)} />
              </div>
              {index > 0 ? <p className={cn('text-center text-[11px] font-black', tone.text)}>{metric.conversion === null ? 'Not recorded' : `${metric.conversion.toFixed(1)}%`}</p> : <p className="text-center text-[11px] font-black text-transparent" aria-hidden="true">—</p>}
            </div>
          )
          })}
        </div>
      </div>
    </section>
  )
}

function WeeklySnapshot({ data }: { data: MyDayData }) {
  return (
    <section aria-labelledby="weekly-snapshot-title" className="crm-panel rounded-xl px-4 py-3 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="weekly-snapshot-title" className="text-[15px] font-black">Weekly Snapshot</h2>
        <p className="text-[10px] font-semibold text-[var(--crm-text-muted)]">{data.week.start} – {data.week.end}</p>
      </div>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed text-[10px]">
          <thead>
            <tr className="text-[9px] font-black text-[var(--crm-text-muted)]">
              <th className="w-[190px] py-1 text-left">Metric</th>
              {data.week.dayLabels.map((day) => <th key={day} className="py-1 text-center">{day}</th>)}
              <th className="py-1 text-center">Week Total</th>
            </tr>
          </thead>
          <tbody>
            {data.week.rows.map((row) => {
              const tone = TONE_STYLES[row.tone]
              return (
                <tr key={row.key} className="border-t border-[var(--crm-border)]/70">
                  <th className="py-1.5 text-left font-bold"><span className="inline-flex items-center gap-2"><Icon name={row.icon} className={cn('text-[15px]', tone.icon)} />{row.label}</span></th>
                  {row.days.map((value, index) => <td key={`${row.key}-${index}`} className="py-1.5 text-center font-bold">{metricValue(value)}</td>)}
                  <td className={cn('py-1.5 text-center text-[12px] font-black', tone.text)}>{metricValue(row.total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 grid grid-cols-2 divide-x divide-[var(--crm-border)] border-t border-[var(--crm-border)] pt-2 sm:grid-cols-4">
        {data.habits.map((habit) => (
          <div key={habit.key} className="flex min-h-9 items-center justify-center gap-3 px-3 text-center">
            <span className="text-[10px] font-extrabold">{habit.label}</span>
            <span className={cn('flex h-8 min-w-8 items-center justify-center rounded-full border-2 px-1 text-[9px] font-black', habit.value === null ? 'border-[var(--crm-border-strong)] text-[var(--crm-text-muted)]' : habit.value >= 90 ? 'border-[var(--crm-success)] text-[var(--crm-success)]' : habit.value >= 70 ? 'border-[#f05a28] text-[#f05a28]' : 'border-[var(--crm-danger)] text-[var(--crm-danger)]')}>{habitValue(habit.value)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function CommitmentsCard({ data }: { data: MyDayData }) {
  return (
    <section aria-labelledby="next-commitments-title" className="crm-panel flex min-h-[284px] flex-col rounded-xl">
      <h2 id="next-commitments-title" className="px-4 pt-3 text-[15px] font-black">Next Commitments</h2>
      <div className="mt-1 flex-1 px-4">
        {data.commitments.length === 0 ? (
          <div className="flex h-full min-h-[190px] flex-col items-center justify-center text-center">
            <Icon name="event_available" className="text-[28px] text-[var(--crm-success)]" />
            <p className="mt-2 text-xs font-bold">No upcoming commitments</p>
            <p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">Casey’s next 14 days are clear.</p>
          </div>
        ) : (
          <ol className="relative border-l-2 border-[#d8e5ff] pl-4">
            {data.commitments.map((item) => (
              <li key={item.id} className="relative py-2">
                <span className="absolute -left-[21px] top-5 h-2.5 w-2.5 rounded-full bg-[#1769e0] ring-4 ring-[var(--crm-surface)]" />
                <Link href={item.href} prefetch className="grid grid-cols-[56px_32px_1fr_16px] items-center gap-2 rounded-lg p-1 hover:bg-[var(--crm-surface-subtle)]">
                  <time className="text-[10px] font-black">{formatDateTime(item.dueAt, 'time', data.generatedAt)}</time>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--crm-info-soft)] text-[var(--crm-info)]"><Icon name={item.icon} className="text-[17px]" /></span>
                  <span className="min-w-0"><strong className="block truncate text-[10px]">{item.title}</strong><span className="block truncate text-[9px] text-[var(--crm-text-muted)]">{item.detail}</span></span>
                  <Icon name="chevron_right" className="text-[16px] text-[var(--crm-text-muted)]" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
      <Link href="/calendar?department=acquisitions" prefetch className="flex items-center justify-between border-t border-[var(--crm-border)] px-4 py-3 text-[10px] font-black text-[var(--crm-info)] hover:bg-[var(--crm-info-soft)]">View full calendar<Icon name="chevron_right" className="text-[17px]" /></Link>
    </section>
  )
}

function QueueCard({ data, selected, onToggle, onAction, onCreateCallingList }: {
  data: MyDayData
  selected: Set<string>
  onToggle: (id: string) => void
  onAction: (item: MyDayQueueItem) => void
  onCreateCallingList: () => void
}) {
  const callableSelected = data.queue.filter((item) => selected.has(item.id) && item.leadId && item.phone)
  return (
    <section aria-labelledby="priority-queue-title" className="crm-panel flex min-h-[284px] min-w-0 flex-col rounded-xl">
      <div className="flex items-center gap-2 px-4 pt-3">
        <h2 id="priority-queue-title" className="text-[15px] font-black">Priority Queue / Next Best Actions</h2>
        <span className="rounded-full bg-[var(--crm-surface-subtle)] px-2 py-0.5 text-[9px] font-black text-[var(--crm-text-muted)]">{data.queue.length}</span>
      </div>
      <div className="mt-1 flex-1 overflow-x-auto px-4">
        {data.queue.length === 0 ? (
          <div className="flex min-h-[190px] flex-col items-center justify-center text-center"><Icon name="task_alt" className="text-[28px] text-[var(--crm-success)]" /><p className="mt-2 text-xs font-bold">Queue cleared</p><p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">No open Casey tasks require action.</p></div>
        ) : (
          <table className="w-full min-w-[720px] table-fixed text-[9px]">
            <thead className="text-[8px] font-black text-[var(--crm-text-muted)]">
              <tr><th className="w-8 py-1"><span className="sr-only">Select</span></th><th className="w-[30%] py-1 text-left">Lead / Task</th><th className="w-[22%] py-1 text-left">Stage / Source</th><th className="w-[14%] py-1 text-left">Priority</th><th className="w-[16%] py-1 text-center">Next Action</th><th className="py-1 text-left">Due By</th></tr>
            </thead>
            <tbody>
              {data.queue.map((item, index) => {
                const stageStyle = STAGE_STYLES[item.stage] || 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text)]'
                const initials = item.leadName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '—'
                const avatarTones = ['bg-[#e7efff] text-[#235fc0]', 'bg-[#eee8ff] text-[#6d28d9]', 'bg-[#e8f7ef] text-[#08753f]', 'bg-[#fff0e8] text-[#b84b14]']
                return (
                  <tr key={item.id} className="border-t border-[var(--crm-border)] hover:bg-[var(--crm-surface-subtle)]">
                    <td className="py-1.5"><input type="checkbox" checked={selected.has(item.id)} onChange={() => onToggle(item.id)} aria-label={`Select ${item.leadName}`} className="h-3.5 w-3.5 accent-[#1769e0]" /></td>
                    <td className="py-1.5 pr-2"><Link href={item.leadId ? `/leads/${item.leadId}` : '/tasks'} prefetch className="flex min-w-0 items-center gap-2"><span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[8px] font-black', avatarTones[index % avatarTones.length])}>{initials}</span><span className="min-w-0"><strong className="block truncate">{item.leadName}</strong><span className="block truncate text-[8px] text-[var(--crm-text-muted)]">{item.property}</span></span></Link></td>
                    <td className="py-1.5 pr-2"><span className={cn('inline-flex rounded border px-2 py-0.5 text-[8px] font-bold', stageStyle)}>{item.stage}</span><span className="mt-0.5 block truncate text-[8px] text-[var(--crm-text-muted)]">{item.source}</span></td>
                    <td className="py-1.5"><span className={cn('inline-flex min-w-[58px] justify-center rounded border px-2 py-0.5 text-[8px] font-bold', PRIORITY_STYLES[item.priority])}>{item.priority}</span></td>
                    <td className="py-1.5 text-center"><button type="button" onClick={() => onAction(item)} className={cn('inline-flex min-w-[70px] items-center justify-center gap-1 rounded border px-2 py-1 text-[8px] font-black', item.action === 'Open' ? 'border-[#1769e0] bg-transparent text-[#1769e0]' : 'border-[#1769e0] bg-[#1769e0] text-white hover:bg-[#0d55bc]')}><Icon name={item.action === 'Call' ? 'call' : item.action === 'SMS' ? 'sms' : 'open_in_new'} className="text-[12px]" />{item.action}</button></td>
                    <td className={cn('py-1.5 font-bold', item.dueAt && new Date(item.dueAt).getTime() < new Date(data.generatedAt).getTime() ? 'text-[var(--crm-danger)]' : '')}>{formatDateTime(item.dueAt, 'due', data.generatedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--crm-border)] px-4 py-2">
        <span className="text-[9px] font-black text-[var(--crm-text-muted)]">{selected.size} selected</span>
        <button type="button" onClick={onCreateCallingList} disabled={callableSelected.length === 0} className="inline-flex min-w-[245px] items-center justify-center gap-2 rounded-md bg-[#0d5ee8] px-4 py-2 text-[10px] font-black text-white shadow-sm hover:bg-[#0b4fc5] disabled:cursor-not-allowed disabled:opacity-45"><Icon name="format_list_numbered" className="text-[15px]" />Create Calling List ({callableSelected.length})</button>
      </div>
    </section>
  )
}

export function MyDayWorkspace({ initialData }: { initialData: MyDayData }) {
  const router = useRouter()
  const [data, setData] = useState(initialData)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const months = useMemo(() => monthOptions(initialData.month), [initialData.month])

  async function changeMonth(month: string, force = false) {
    if (!force && month === data.month) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/my-day?month=${encodeURIComponent(month)}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'The month could not load.')
      setData(payload as MyDayData)
      setSelected(new Set())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The month could not load.')
    } finally {
      setLoading(false)
    }
  }

  function toggleQueueItem(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function runAction(item: MyDayQueueItem) {
    if (item.action === 'Call' && item.leadId && item.phone) {
      window.dispatchEvent(new CustomEvent('open-dialer', { detail: { leadId: item.leadId, phone: item.phone, name: item.leadName } }))
      return
    }
    if (item.action === 'SMS' && item.leadId) {
      router.push(`/conversations?lead=${encodeURIComponent(item.leadId)}`)
      return
    }
    router.push(item.leadId ? `/leads/${item.leadId}` : '/tasks')
  }

  function createCallingList() {
    const leadIds = data.queue.filter((item) => selected.has(item.id) && item.leadId && item.phone).map((item) => item.leadId!)
    if (leadIds.length === 0) return
    router.push(`/dialer?lead_ids=${encodeURIComponent(leadIds.join(','))}&return_to=${encodeURIComponent('/my-day')}`)
  }

  return (
    <main className="relative mx-auto flex w-full max-w-[1440px] flex-col gap-2.5 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h1 className="text-[25px] font-black tracking-[-0.03em]">My Day</h1>
          <p className="mt-0.5 text-[11px] font-semibold text-[var(--crm-text-muted)]">{greeting(data.generatedAt)}, Casey</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="relative">
            <span className="sr-only">Month</span>
            <Icon name="calendar_month" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[17px] text-[var(--crm-text-muted)]" />
            <select value={data.month} onChange={(event) => void changeMonth(event.target.value)} disabled={loading} className="crm-field h-10 min-w-[168px] appearance-none rounded-lg pl-10 pr-9 text-[11px] font-black outline-none disabled:opacity-60">
              {months.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
            </select>
            <Icon name="expand_more" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[17px] text-[var(--crm-text-muted)]" />
          </label>
          <label className="relative">
            <span className="sr-only">Agent</span>
            <span className="pointer-events-none absolute left-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[#1769e0] text-[10px] font-black text-white">C</span>
            <select aria-label="Agent" value="casey" disabled className="crm-field h-10 min-w-[130px] appearance-none rounded-lg pl-11 pr-9 text-[11px] font-black outline-none disabled:cursor-default disabled:opacity-100">
              <option value="casey">Casey</option>
            </select>
            <Icon name="expand_more" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[17px] text-[var(--crm-text-muted)]" />
          </label>
        </div>
      </header>
      {error ? <div role="alert" className="flex items-center justify-between rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-4 py-2 text-xs font-bold text-[var(--crm-danger)]"><span>{error}</span><button type="button" onClick={() => void changeMonth(data.month, true)} className="underline">Retry</button></div> : null}
      <FunnelCard metrics={data.funnel} />
      <WeeklySnapshot data={data} />
      <div className="grid min-w-0 gap-2.5 lg:grid-cols-[270px_minmax(0,1fr)]">
        <CommitmentsCard data={data} />
        <QueueCard data={data} selected={selected} onToggle={toggleQueueItem} onAction={runAction} onCreateCallingList={createCallingList} />
      </div>
      {loading ? <div role="status" aria-live="polite" className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-[var(--crm-canvas)]/70 backdrop-blur-[1px]"><span className="rounded-full border border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-2 text-xs font-black shadow-lg">Loading Casey’s month…</span></div> : null}
    </main>
  )
}
