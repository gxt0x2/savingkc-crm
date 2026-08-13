'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Icon } from '@/components/ui/icon'
import {
  buildAcquisitionsReport,
  filterAcquisitionContacts,
  type AcquisitionContact,
  type AcquisitionThread,
  type ReportPeriod,
} from '@/lib/acquisitions-report'
import { formatLeadSource } from '@/lib/contact-display'
import { BottleneckCalculator } from './BottleneckCalculator'

type ReportView = 'overview' | 'acquisitions' | 'agents' | 'marketing' | 'dispositions' | 'data-quality'

interface YtdKpis {
  agent: string
  monthly: { month: string; dialTimeHrs: number; calls: number; contacts: number; leads: number; appointments: number }[]
  ytd: { dialTimeHrs: number; calls: number; contacts: number; leads: number; appointments: number; contactRate: string; leadRate: string; months: number }
}

interface AppointmentStats {
  showRate30Day: number
  totalAppointments: number
  completed: number
  noShows: number
  cancelled: number
  ghostProtocolRecoveryRate: number
}

interface Financials {
  total: { revenue: number; expenses: number; net: number }
}

interface ReportData {
  contacts: AcquisitionContact[]
  threads: AcquisitionThread[]
  ytd: YtdKpis | null
  appointments: AppointmentStats | null
  financials: Financials | null
}

const VIEW_COPY: Record<ReportView, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: 'Reports workspace', title: 'Operating overview', description: 'The few signals leadership needs before opening a deeper report.' },
  acquisitions: { eyebrow: 'Acquisitions performance', title: 'Acquisitions command center', description: 'Pipeline attention, conversion, source quality, activity, and revenue in one operating view.' },
  agents: { eyebrow: 'Coaching and capacity', title: 'Agent performance', description: 'Calling activity, appointment outcomes, and the behaviors that create real opportunities.' },
  marketing: { eyebrow: 'Lead-source intelligence', title: 'Marketing performance', description: 'Which sources create opportunities, appointments, and signed contracts.' },
  dispositions: { eyebrow: 'Contract-to-close', title: 'Disposition performance', description: 'Pipeline handoff, contracts, closes, and realized economics.' },
  'data-quality': { eyebrow: 'Operating integrity', title: 'Data quality', description: 'Missing ownership, next actions, contact fields, and activity that weaken automation and reporting.' },
}

const VIEW_VALUES = new Set<ReportView>(['overview', 'acquisitions', 'agents', 'marketing', 'dispositions', 'data-quality'])
const PERIOD_LABELS: Record<ReportPeriod, string> = { '30d': 'Last 30 days', quarter: 'This quarter', ytd: 'Year to date', all: 'All time' }

async function requiredJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Report data unavailable: ${url}`)
  return response.json() as Promise<T>
}

async function optionalJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    return response.ok ? response.json() as Promise<T> : null
  } catch {
    return null
  }
}

function useReportData() {
  return useQuery<ReportData>({
    queryKey: ['acquisitions-performance-report'],
    queryFn: async () => {
      const [contactsPayload, hubPayload, ytd, appointments, financials] = await Promise.all([
        requiredJson<{ items?: AcquisitionContact[] }>('/api/contacts'),
        requiredJson<{ items?: AcquisitionThread[] }>('/api/conversations/hub'),
        optionalJson<YtdKpis>('/api/dashboard/kpis'),
        optionalJson<AppointmentStats>('/api/dashboard/appointment-stats'),
        optionalJson<Financials>('/api/financials'),
      ])
      return {
        contacts: contactsPayload.items ?? [],
        threads: hubPayload.items ?? [],
        ytd,
        appointments,
        financials,
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function AcquisitionsReportsWorkspace() {
  const searchParams = useSearchParams()
  const requestedView = searchParams.get('view') as ReportView | null
  const view = requestedView && VIEW_VALUES.has(requestedView) ? requestedView : 'acquisitions'
  const [period, setPeriod] = useState<ReportPeriod>('ytd')
  const { data, error, isLoading, isFetching, refetch } = useReportData()
  const contacts = useMemo(() => filterAcquisitionContacts(data?.contacts ?? [], period), [data?.contacts, period])
  const report = useMemo(() => buildAcquisitionsReport(contacts, data?.threads ?? []), [contacts, data?.threads])
  const copy = VIEW_COPY[view]

  if (isLoading) return <ReportsSkeleton />

  if (error) {
    return (
      <main className="mx-auto max-w-[1540px] px-5 py-8">
        <div className="crm-panel rounded-2xl p-8 text-center">
          <Icon name="cloud_off" className="text-4xl text-[var(--crm-brand)]" />
          <h1 className="mt-3 text-xl font-black">Acquisitions reporting is temporarily unavailable</h1>
          <p className="mt-2 text-sm text-[var(--crm-text-muted)]">The underlying contact or conversation workspace could not be loaded.</p>
          <button type="button" onClick={() => refetch()} className="crm-primary-button mt-5 rounded-lg px-4 py-2 text-sm font-bold">Try again</button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-[1540px] space-y-6 px-5 py-6 pb-24 lg:px-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="crm-eyebrow">{copy.eyebrow}</p>
          <h1 className="mt-1 text-[30px] font-black tracking-[-0.035em] text-[var(--crm-ink)]">{copy.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--crm-text-muted)]">{copy.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 text-xs font-bold text-[var(--crm-text-muted)]">
            <Icon name="date_range" className="text-[17px] text-[var(--crm-info)]" />
            <span className="sr-only">Reporting period</span>
            <select aria-label="Reporting period" value={period} onChange={(event) => setPeriod(event.target.value as ReportPeriod)} className="bg-transparent text-xs font-bold text-[var(--crm-ink)] outline-none">
              {Object.entries(PERIOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--crm-success)]/25 bg-[var(--crm-success-soft)] px-3 text-xs font-bold text-[var(--crm-success)]">
            <span className={`h-2 w-2 rounded-full bg-[var(--crm-success)] ${isFetching ? 'animate-pulse' : ''}`} />
            Live CRM data
          </span>
        </div>
      </header>

      {view === 'overview' ? <OverviewView report={report} revenue={data?.financials?.total.revenue ?? 0} /> : null}
      {view === 'acquisitions' ? <AcquisitionsView report={report} ytd={data?.ytd ?? null} appointments={data?.appointments ?? null} financials={data?.financials ?? null} /> : null}
      {view === 'agents' ? <AgentView ytd={data?.ytd ?? null} appointments={data?.appointments ?? null} report={report} /> : null}
      {view === 'marketing' ? <MarketingView report={report} /> : null}
      {view === 'dispositions' ? <DispositionView report={report} financials={data?.financials ?? null} /> : null}
      {view === 'data-quality' ? <DataQualityView report={report} /> : null}
    </main>
  )
}

type Report = ReturnType<typeof buildAcquisitionsReport>

function OverviewView({ report, revenue }: { report: Report; revenue: number }) {
  return (
    <>
      <AttentionGrid report={report} />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="group_add" label="New leads" value={report.stages[0].value} detail={`${report.active} active pipeline records`} tone="info" href="/contacts?list=new" />
        <MetricCard icon="verified" label="Opportunities" value={report.qualified} detail={`${rate(report.qualified, report.total)}% of leads`} tone="success" href="/contacts?min_stage=qualified" />
        <MetricCard icon="description" label="Under contract" value={report.contracts} detail={`${report.closed} closed won`} tone="violet" href="/contacts?min_stage=under_contract" />
        <MetricCard icon="payments" label="Revenue" value={moneyShort(revenue)} detail="Recorded CRM financials" tone="brand" href="/dashboard?view=dispositions" />
      </section>
      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.8fr]">
        <FunnelPanel report={report} />
        <BottleneckCard report={report} />
      </div>
    </>
  )
}

function AcquisitionsView({ report, ytd, appointments, financials }: { report: Report; ytd: YtdKpis | null; appointments: AppointmentStats | null; financials: Financials | null }) {
  return (
    <>
      <AttentionGrid report={report} />
      <section aria-labelledby="pipeline-heading" className="crm-panel overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--crm-border)] px-5 py-4">
          <div><p className="crm-eyebrow">Pipeline outcomes</p><h2 id="pipeline-heading" className="mt-1 text-lg font-black">From inquiry to closed revenue</h2></div>
          <div className="flex flex-wrap gap-5 text-xs text-[var(--crm-text-muted)]">
            <span><strong className="text-[var(--crm-ink)]">{report.averageSpeedToLeadMinutes ?? '—'}</strong> min avg first action</span>
            <span><strong className="text-[var(--crm-ink)]">{appointments?.showRate30Day ?? '—'}%</strong> appointment show rate</span>
            <span><strong className="text-[var(--crm-ink)]">{moneyShort(financials?.total.revenue ?? 0)}</strong> recorded revenue</span>
          </div>
        </div>
        <FunnelStrip report={report} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <SourcePerformance report={report} />
        <div className="space-y-5">
          <BottleneckCard report={report} />
          <OutcomeCard appointments={appointments} />
        </div>
      </div>

      <ActivitySnapshot ytd={ytd} />

      <details className="crm-panel group overflow-hidden rounded-2xl">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden">
          <div><p className="crm-eyebrow">Scenario planning</p><h2 className="mt-1 text-lg font-black">Model the next constraint before changing the operation</h2></div>
          <span className="crm-secondary-button inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold"><Icon name="calculate" /> Open model <Icon name="expand_more" className="transition-transform group-open:rotate-180" /></span>
        </summary>
        <div className="border-t border-[var(--crm-border)] p-4"><BottleneckCalculator /></div>
      </details>
    </>
  )
}

function AgentView({ ytd, appointments, report }: { ytd: YtdKpis | null; appointments: AppointmentStats | null; report: Report }) {
  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="phone_in_talk" label="Calls tracked" value={ytd?.ytd.calls ?? 0} detail={`${ytd?.ytd.dialTimeHrs.toFixed(1) ?? '0'} dialing hours`} tone="info" href="/dialer?section=analytics" />
        <MetricCard icon="forum" label="Contacts" value={ytd?.ytd.contacts ?? 0} detail={`${ytd?.ytd.contactRate ?? '0'}% contact rate`} tone="violet" href="/dialer?section=conversations" />
        <MetricCard icon="calendar_month" label="Appointments" value={ytd?.ytd.appointments ?? 0} detail={`${appointments?.showRate30Day ?? '—'}% 30-day show rate`} tone="success" href="/calendar?department=acquisitions" />
        <MetricCard icon="priority_high" label="Overdue actions" value={report.attention.overdue} detail="Coaching and execution risk" tone="brand" href="/contacts?list=overdue" />
      </section>
      <ActivitySnapshot ytd={ytd} expanded />
      <div className="grid gap-5 lg:grid-cols-2">
        <OutcomeCard appointments={appointments} />
        <NextCoachingCard ytd={ytd} report={report} />
      </div>
    </>
  )
}

function MarketingView({ report }: { report: Report }) {
  return (
    <>
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard icon="ads_click" label="Lead sources" value={report.sources.length} detail={`${report.total} leads represented`} tone="info" href="/reports/marketing" />
        <MetricCard icon="verified" label="Opportunities" value={report.qualified} detail={`${rate(report.qualified, report.total)}% opportunity rate`} tone="success" href="/contacts?min_stage=qualified" />
        <MetricCard icon="description" label="Contracts" value={report.contracts} detail={`${rate(report.contracts, report.total)}% lead-to-contract`} tone="violet" href="/contacts?min_stage=under_contract" />
      </section>
      <SourcePerformance report={report} expanded />
      <div className="flex justify-end"><Link href="/reports/marketing" className="crm-primary-button inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold">Open marketing dashboard <Icon name="arrow_forward" /></Link></div>
    </>
  )
}

function DispositionView({ report, financials }: { report: Report; financials: Financials | null }) {
  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="contract" label="Contracts" value={report.contracts} detail="Reached disposition handoff" tone="violet" href="/dispo/pipeline" />
        <MetricCard icon="task_alt" label="Closed won" value={report.closed} detail={`${rate(report.closed, report.contracts)}% contract-to-close`} tone="success" href="/contacts?stage=closed_won" />
        <MetricCard icon="payments" label="Gross revenue" value={moneyShort(financials?.total.revenue ?? 0)} detail="Recorded financial activity" tone="info" href="/dispo/tc?view=reports" />
        <MetricCard icon="account_balance" label="Net" value={moneyShort(financials?.total.net ?? 0)} detail="Revenue less recorded expenses" tone="brand" href="/dispo/tc?view=reports" />
      </section>
      <section className="crm-panel rounded-2xl p-5">
        <p className="crm-eyebrow">Post-close operating loop</p>
        <h2 className="mt-1 text-xl font-black">Closeout → financial reconciliation → debrief → workflow improvement</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--crm-text-muted)]">Closed transactions should not disappear. The transaction coordinator records actual economics and completion, then the acquisition and disposition owners complete a short debrief whose findings feed this report and future workflow changes.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/dispo/pipeline" className="crm-primary-button inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold">Open disposition pipeline <Icon name="arrow_forward" /></Link>
          <Link href="/dispo/tc?view=reports" className="crm-secondary-button inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold">Open closeout reports</Link>
        </div>
      </section>
    </>
  )
}

function DataQualityView({ report }: { report: Report }) {
  const items = [
    { label: 'Missing phone', value: report.dataQuality.missingPhone, icon: 'phone_disabled', href: '/contacts?gap=missing_phone', detail: 'Cannot call or text' },
    { label: 'Missing email', value: report.dataQuality.missingEmail, icon: 'mail', href: '/contacts?gap=missing_email', detail: 'Cannot send email follow-up' },
    { label: 'Unassigned', value: report.dataQuality.unassigned, icon: 'person_off', href: '/contacts?list=unassigned', detail: 'No accountable owner' },
    { label: 'No activity', value: report.dataQuality.noActivity, icon: 'history_toggle_off', href: '/contacts?activity=none', detail: 'No communication history' },
    { label: 'Missing next action', value: report.dataQuality.missingNextAction, icon: 'event_busy', href: '/contacts?gap=missing_next_action', detail: 'No defined follow-up' },
    { label: 'Stale over 7 days', value: report.attention.stale, icon: 'timer_off', href: '/contacts?activity=stale', detail: 'Active relationship may be drifting' },
  ]
  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => <QualityCard key={item.label} {...item} total={report.total} />)}
      </section>
      <section className="crm-panel rounded-2xl p-5">
        <p className="crm-eyebrow">Why it matters</p>
        <h2 className="mt-1 text-xl font-black">Automation can only be as reliable as identity, ownership, stage, communication, and next action.</h2>
        <p className="mt-2 max-w-4xl text-sm text-[var(--crm-text-muted)]">These are operating-model defects, not clerical imperfections. Each card opens the exact affected contact set so the team can repair the data at the source.</p>
      </section>
    </>
  )
}

function AttentionGrid({ report }: { report: Report }) {
  return (
    <section aria-labelledby="attention-heading">
      <div className="mb-3 flex items-end justify-between gap-3"><div><p className="crm-eyebrow">Needs attention now</p><h2 id="attention-heading" className="mt-1 text-lg font-black">Work that can change today&apos;s result</h2></div><span className="text-xs text-[var(--crm-text-muted)]">Click any card to open the affected records</span></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <AttentionCard icon="mark_chat_unread" label="Needs reply" value={report.attention.needsReply} href="/contacts?list=needs_reply" tone="brand" />
        <AttentionCard icon="event_busy" label="Overdue actions" value={report.attention.overdue} href="/contacts?list=overdue" tone="danger" />
        <AttentionCard icon="person_off" label="Unassigned" value={report.attention.unassigned} href="/contacts?list=unassigned" tone="violet" />
        <AttentionCard icon="local_fire_department" label="Hot opportunities" value={report.attention.hot} href="/contacts?list=hot" tone="success" />
        <AttentionCard icon="timer_off" label="Stale 7+ days" value={report.attention.stale} href="/contacts?activity=stale" tone="info" />
      </div>
    </section>
  )
}

const ATTENTION_TONES = {
  brand: 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]',
  danger: 'border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  violet: 'border-[var(--crm-violet)]/25 bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]',
  success: 'border-[var(--crm-success)]/25 bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  info: 'border-[var(--crm-info)]/25 bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
} as const

function AttentionCard({ icon, label, value, href, tone }: { icon: string; label: string; value: number; href: string; tone: keyof typeof ATTENTION_TONES }) {
  return (
    <Link href={href} className={`group flex min-h-24 items-center gap-3 rounded-xl border p-4 transition-transform hover:-translate-y-0.5 ${ATTENTION_TONES[tone]}`}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-current/10"><Icon name={icon} className="text-[23px]" /></span>
      <span className="min-w-0"><strong className="block text-2xl font-black tabular-nums text-[var(--crm-ink)]">{value}</strong><span className="block text-xs font-bold">{label}</span></span>
      <Icon name="arrow_forward" className="ml-auto text-[17px] opacity-55 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

const METRIC_TONES = {
  brand: ['bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]', 'border-t-[var(--crm-brand)]'],
  info: ['bg-[var(--crm-info-soft)] text-[var(--crm-info)]', 'border-t-[var(--crm-info)]'],
  success: ['bg-[var(--crm-success-soft)] text-[var(--crm-success)]', 'border-t-[var(--crm-success)]'],
  violet: ['bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]', 'border-t-[var(--crm-violet)]'],
} as const

function MetricCard({ icon, label, value, detail, tone, href }: { icon: string; label: string; value: number | string; detail: string; tone: keyof typeof METRIC_TONES; href: string }) {
  const [iconTone, topTone] = METRIC_TONES[tone]
  return (
    <Link href={href} className={`crm-panel group rounded-2xl border-t-[3px] p-4 transition-transform hover:-translate-y-0.5 ${topTone}`}>
      <div className="flex items-start justify-between gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconTone}`}><Icon name={icon} className="text-[21px]" /></span><Icon name="arrow_outward" className="text-[18px] text-[var(--crm-text-dim)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></div>
      <strong className="mt-4 block text-[30px] font-black leading-none tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</strong>
      <span className="mt-2 block text-sm font-black">{label}</span><span className="mt-1 block text-xs text-[var(--crm-text-muted)]">{detail}</span>
    </Link>
  )
}

function FunnelStrip({ report }: { report: Report }) {
  return (
    <div className="grid divide-y divide-[var(--crm-border)] md:grid-cols-3 md:divide-x md:divide-y-0 xl:grid-cols-6">
      {report.stages.map((stage, index) => {
        const conversion = index > 0 ? report.conversions[index - 1] : null
        return <Link key={stage.key} href={stageHref(stage.key)} className="group relative px-5 py-5 hover:bg-[var(--crm-surface-subtle)]"><span className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)]">{stage.label}</span><strong className="mt-2 block text-3xl font-black tabular-nums">{stage.value}</strong><span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-black ${conversion && conversion.rate < 25 ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'}`}>{conversion ? `${conversion.rate}% from ${conversion.previousLabel.toLowerCase()}` : 'Pipeline entry'}</span><Icon name="arrow_forward" className="absolute right-3 top-5 text-[16px] text-[var(--crm-text-dim)] opacity-0 transition-opacity group-hover:opacity-100" /></Link>
      })}
    </div>
  )
}

function FunnelPanel({ report }: { report: Report }) {
  return <section className="crm-panel overflow-hidden rounded-2xl"><div className="border-b border-[var(--crm-border)] px-5 py-4"><p className="crm-eyebrow">Funnel health</p><h2 className="mt-1 text-lg font-black">Conversion by operating stage</h2></div><FunnelStrip report={report} /></section>
}

function BottleneckCard({ report }: { report: Report }) {
  const bottleneck = report.bottleneck
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--crm-brand-border)] bg-gradient-to-br from-[var(--crm-brand-soft)] to-[var(--crm-surface)] p-5">
      <div className="flex items-start justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--crm-brand)] text-white"><Icon name="troubleshoot" className="text-[23px]" /></span><span className="rounded-full bg-[var(--crm-surface)] px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-brand)]">Current constraint</span></div>
      <h2 className="mt-5 text-xl font-black">{bottleneck.previousLabel} → {bottleneck.label}</h2>
      <div className="mt-2 flex items-end gap-3"><strong className="text-5xl font-black leading-none text-[var(--crm-brand)]">{bottleneck.rate}%</strong><span className="pb-1 text-xs font-semibold text-[var(--crm-text-muted)]">stage conversion</span></div>
      <p className="mt-4 text-sm leading-6 text-[var(--crm-text-muted)]">Improve this handoff before increasing lead volume. More inputs will amplify the same constraint.</p>
    </section>
  )
}

function SourcePerformance({ report, expanded = false }: { report: Report; expanded?: boolean }) {
  const rows = report.sources.slice(0, expanded ? 12 : 7)
  return (
    <section className="crm-panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-[var(--crm-border)] px-5 py-4"><div><p className="crm-eyebrow">Source quality</p><h2 className="mt-1 text-lg font-black">Which channels create real pipeline</h2></div><Link href="/reports/marketing" className="text-xs font-black text-[var(--crm-brand)] hover:underline">Full marketing view</Link></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] uppercase tracking-[0.12em] text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Source</th><th className="px-3 py-3 text-right">Leads</th><th className="px-3 py-3 text-right">Opportunities</th><th className="px-3 py-3 text-right">Appointments</th><th className="px-3 py-3 text-right">Contracts</th><th className="px-5 py-3 text-right">Avg score</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{rows.map((source) => <tr key={source.source} className="hover:bg-[var(--crm-surface-subtle)]"><td className="px-5 py-3 font-bold">{formatLeadSource(source.source)}</td><td className="px-3 py-3 text-right tabular-nums">{source.leads}</td><td className="px-3 py-3 text-right tabular-nums text-[var(--crm-success)]">{source.qualified}</td><td className="px-3 py-3 text-right tabular-nums text-[var(--crm-info)]">{source.appointments}</td><td className="px-3 py-3 text-right font-black tabular-nums text-[var(--crm-violet)]">{source.contracts}</td><td className="px-5 py-3 text-right"><span className="rounded-full bg-[var(--crm-violet-soft)] px-2 py-1 font-black text-[var(--crm-violet)]">{source.averageScore}</span></td></tr>)}</tbody></table></div>
      {rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-[var(--crm-text-muted)]">No source data in this reporting period.</p> : null}
    </section>
  )
}

function OutcomeCard({ appointments }: { appointments: AppointmentStats | null }) {
  const showRate = appointments?.showRate30Day ?? 0
  return <section className="crm-panel rounded-2xl p-5"><p className="crm-eyebrow">Appointment outcomes</p><div className="mt-3 flex items-center gap-4"><span className="flex h-20 w-20 items-center justify-center rounded-full border-[8px] border-[var(--crm-success-soft)] text-2xl font-black text-[var(--crm-success)]">{showRate}%</span><div><h2 className="font-black">30-day show rate</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">{appointments?.completed ?? 0} completed · {appointments?.noShows ?? 0} no-shows · {appointments?.cancelled ?? 0} cancelled</p></div></div><Link href="/calendar?department=acquisitions" className="mt-5 inline-flex items-center gap-2 text-xs font-black text-[var(--crm-brand)] hover:underline">Review appointment outcomes <Icon name="arrow_forward" /></Link></section>
}

function ActivitySnapshot({ ytd, expanded = false }: { ytd: YtdKpis | null; expanded?: boolean }) {
  const months = ytd?.monthly ?? []
  const maxCalls = Math.max(1, ...months.map((month) => month.calls))
  return (
    <section className="crm-panel overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--crm-border)] px-5 py-4"><div><p className="crm-eyebrow">Agent activity</p><h2 className="mt-1 text-lg font-black">{ytd?.agent ? `${ytd.agent} — KPI tracker` : 'KPI tracker'}</h2></div><span className="text-xs text-[var(--crm-text-muted)]">YTD source · acquisition KPI tracker</span></div>
      <div className={`grid gap-5 p-5 ${expanded ? 'xl:grid-cols-[1.5fr_0.7fr]' : 'xl:grid-cols-[1.4fr_0.8fr]'}`}>
        <div className="space-y-4">{months.map((month) => <div key={month.month} className="grid grid-cols-[72px_1fr_90px] items-center gap-3"><span className="text-xs font-bold text-[var(--crm-text-muted)]">{month.month.replace(' 2026', '')}</span><div className="h-8 overflow-hidden rounded-lg bg-[var(--crm-surface-subtle)]"><div className="flex h-full items-center justify-end rounded-lg bg-gradient-to-r from-[var(--crm-brand)] to-[var(--crm-violet)] px-3 text-[10px] font-black text-white" style={{ width: `${Math.max(8, (month.calls / maxCalls) * 100)}%` }}>{month.calls.toLocaleString()}</div></div><span className="text-right text-[10px] text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-success)]">{month.contacts}</strong> contacts</span></div>)}</div>
        <div className="grid grid-cols-2 gap-3"><SmallStat label="Calls" value={ytd?.ytd.calls ?? 0} /><SmallStat label="Contacts" value={ytd?.ytd.contacts ?? 0} /><SmallStat label="Leads" value={ytd?.ytd.leads ?? 0} /><SmallStat label="Appointments" value={ytd?.ytd.appointments ?? 0} /></div>
      </div>
    </section>
  )
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-[var(--crm-surface-subtle)] p-3"><strong className="block text-xl font-black tabular-nums">{value.toLocaleString()}</strong><span className="mt-1 block text-[10px] font-black uppercase tracking-[0.1em] text-[var(--crm-text-muted)]">{label}</span></div>
}

function NextCoachingCard({ ytd, report }: { ytd: YtdKpis | null; report: Report }) {
  const contactRate = Number(ytd?.ytd.contactRate ?? 0)
  const message = report.attention.overdue > 0
    ? `Clear ${report.attention.overdue} overdue action${report.attention.overdue === 1 ? '' : 's'} before adding more calling volume.`
    : contactRate < 10
      ? 'Contact rate is the coaching priority. Review calling windows, list quality, and number reputation.'
      : 'Execution is current. Coach for stronger qualification and stage advancement.'
  return <section className="rounded-2xl border border-[var(--crm-violet)]/25 bg-[var(--crm-violet-soft)] p-5"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--crm-violet)] text-white"><Icon name="psychology" className="text-[23px]" /></span><p className="mt-5 text-[10px] font-black uppercase tracking-[0.15em] text-[var(--crm-violet)]">Next coaching focus</p><h2 className="mt-2 text-xl font-black">{message}</h2><Link href="/dashboard?view=data-quality" className="mt-5 inline-flex items-center gap-2 text-xs font-black text-[var(--crm-violet)] hover:underline">Review operating integrity <Icon name="arrow_forward" /></Link></section>
}

function QualityCard({ label, value, icon, href, detail, total }: { label: string; value: number; icon: string; href: string; detail: string; total: number }) {
  const percentage = rate(value, total)
  return <Link href={href} className="crm-panel group rounded-2xl p-5 transition-transform hover:-translate-y-0.5"><div className="flex items-start justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--crm-info-soft)] text-[var(--crm-info)]"><Icon name={icon} className="text-[22px]" /></span><Icon name="arrow_outward" className="text-[var(--crm-text-dim)]" /></div><div className="mt-5 flex items-end justify-between gap-3"><strong className="text-4xl font-black tabular-nums">{value}</strong><span className="rounded-full bg-[var(--crm-surface-subtle)] px-2 py-1 text-[10px] font-black text-[var(--crm-text-muted)]">{percentage}%</span></div><h2 className="mt-2 font-black">{label}</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">{detail}</p></Link>
}

function ReportsSkeleton() {
  return <main className="mx-auto max-w-[1540px] space-y-6 px-5 py-6 lg:px-8" aria-label="Loading reports"><div className="h-20 animate-pulse rounded-2xl bg-[var(--crm-surface-subtle)]" /><div className="grid gap-3 md:grid-cols-5">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-[var(--crm-surface-subtle)]" />)}</div><div className="h-80 animate-pulse rounded-2xl bg-[var(--crm-surface-subtle)]" /></main>
}

export function stageHref(stage: string): string {
  const map: Record<string, string> = { leads: '/contacts', qualified: '/contacts?min_stage=qualified', appointments: '/contacts?min_stage=appointment_set', offers: '/contacts?min_stage=offer_made', contracts: '/contacts?min_stage=under_contract', closed: '/contacts?stage=closed_won' }
  return map[stage] ?? '/contacts'
}

export function rate(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

export function moneyShort(amount: number): string {
  const absolute = Math.abs(amount)
  if (absolute >= 1_000_000) return `${amount < 0 ? '-' : ''}$${(absolute / 1_000_000).toFixed(1)}m`
  if (absolute >= 1_000) return `${amount < 0 ? '-' : ''}$${(absolute / 1_000).toFixed(1)}k`
  return `${amount < 0 ? '-' : ''}$${absolute.toLocaleString()}`
}
