'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Icon } from '@/components/ui/icon'
import { formatLeadSource } from '@/lib/contact-display'
import type { OperatingReport, OperatingReportPeriod } from '@/lib/operating-report'

export type OperatingReportView = 'dashboard' | 'marketing' | 'acquisitions' | 'dispositions' | 'finance' | 'call-sms'

const VIEW_COPY: Record<OperatingReportView, { eyebrow: string; title: string; description: string }> = {
  dashboard: { eyebrow: 'SavingKC command center', title: 'CEO Operating System', description: 'A real-time view of attention, pipeline, communication, disposition, and recorded economics.' },
  marketing: { eyebrow: 'Reports · Marketing', title: 'Marketing performance', description: 'Lead-source quality measured by seller records, stage advancement, contracts, and attributed revenue.' },
  acquisitions: { eyebrow: 'Reports · Acquisitions', title: 'Acquisitions performance', description: 'The operating path from new inquiry to qualified seller, appointment, contract, and close.' },
  dispositions: { eyebrow: 'Reports · Dispositions', title: 'Dispositions performance', description: 'Buyer demand, offers, contract-to-close execution, assignment economics, and the post-close debrief loop.' },
  finance: { eyebrow: 'Reports · Finance', title: 'Financial performance', description: 'Recorded revenue and expenses only. Seed and sample transactions are excluded.' },
  'call-sms': { eyebrow: 'Reports · Call/SMS', title: 'Call and SMS performance', description: 'Connected calls, messages, response signals, agent activity, and unresolved seller attention.' },
}

const PERIOD_LABELS: Record<OperatingReportPeriod, string> = {
  '30d': 'Last 30 days',
  quarter: 'This quarter',
  ytd: 'Year to date',
  all: 'All time',
}

const TONES = {
  green: { icon: 'bg-[#e8f8ef] text-[#07883f]', line: '#07883f', border: 'border-[#c7ead4]' },
  violet: { icon: 'bg-[#f2ecff] text-[#6d28d9]', line: '#7c3aed', border: 'border-[#ddd0fa]' },
  blue: { icon: 'bg-[#eaf2ff] text-[#1769e0]', line: '#1769e0', border: 'border-[#cbdcff]' },
  coral: { icon: 'bg-[#fff0ea] text-[#e44c23]', line: '#e44c23', border: 'border-[#ffd7c8]' },
  amber: { icon: 'bg-[#fff6dc] text-[#b77900]', line: '#d59600', border: 'border-[#f3df9e]' },
  teal: { icon: 'bg-[#e4f8f7] text-[#087f7b]', line: '#087f7b', border: 'border-[#bfe9e6]' },
  red: { icon: 'bg-[#ffeded] text-[var(--crm-brand)]', line: '#e32e2e', border: 'border-[var(--crm-brand-border)]' },
} as const

function useOperatingReport(period: OperatingReportPeriod) {
  return useQuery<OperatingReport>({
    queryKey: ['operating-report', period],
    queryFn: async () => {
      const response = await fetch(`/api/reports/operating?period=${period}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Operating report unavailable')
      return response.json() as Promise<OperatingReport>
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function OperatingReportsWorkspace({ view }: { view: OperatingReportView }) {
  const [period, setPeriod] = useState<OperatingReportPeriod>('30d')
  const { data, error, isLoading, isFetching, refetch } = useOperatingReport(period)
  const copy = VIEW_COPY[view]

  if (isLoading) return <ReportSkeleton />
  if (error || !data) {
    return <ReportError onRetry={() => void refetch()} />
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 pb-24 sm:px-6 lg:px-7">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="crm-eyebrow">{copy.eyebrow}</p>
          <h1 className="mt-1 text-[28px] font-black tracking-[-0.035em] text-[var(--crm-ink)]">{copy.title}</h1>
          <p className="mt-1 max-w-4xl text-sm font-medium text-[var(--crm-text-muted)]">{copy.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 shadow-sm">
            <Icon name="date_range" className="text-[19px] text-[var(--crm-brand)]" />
            <span className="sr-only">Reporting period</span>
            <select aria-label="Reporting period" value={period} onChange={(event) => setPeriod(event.target.value as OperatingReportPeriod)} className="bg-transparent text-xs font-black text-[var(--crm-ink)] outline-none">
              {Object.entries(PERIOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <span className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#bfe9d0] bg-[#effbf4] px-3 text-xs font-black text-[#087b3b]">
            <span className={`h-2 w-2 rounded-full bg-[#11a857] ${isFetching ? 'animate-pulse' : ''}`} />
            Live CRM · {formatTimestamp(data.generatedAt)}
          </span>
        </div>
      </header>

      <CoverageNotice report={data} />
      {view === 'dashboard' ? <DashboardView report={data} /> : null}
      {view === 'acquisitions' ? <AcquisitionsView report={data} /> : null}
      {view === 'marketing' ? <MarketingView report={data} /> : null}
      {view === 'dispositions' ? <DispositionsView report={data} /> : null}
      {view === 'finance' ? <FinanceView report={data} /> : null}
      {view === 'call-sms' ? <CallSmsView report={data} /> : null}
    </main>
  )
}

function DashboardView({ report }: { report: OperatingReport }) {
  const cards = [
    { icon: 'payments', label: 'Revenue', value: report.availability.finance ? money(report.core.revenue) : 'Unavailable', detail: report.availability.finance ? `${report.finance.revenueTransactions} recorded transaction${report.finance.revenueTransactions === 1 ? '' : 's'}` : 'Financial source unavailable', tone: 'green' as const, href: '/reports/finance' },
    { icon: 'route', label: 'Active pipeline', value: report.core.activePipeline, detail: `${report.core.leads} leads in period cohort`, tone: 'violet' as const, href: '/reports/acquisitions' },
    { icon: 'task_alt', label: 'Closings', value: report.availability.dispositions ? report.dispositions.closedDeals : 'Unavailable', detail: 'Disposition deals closed in period', tone: 'blue' as const, href: '/reports/dispositions' },
    { icon: 'description', label: 'Under contract', value: report.core.underContract, detail: 'Current stage in selected cohort', tone: 'amber' as const, href: '/contacts?min_stage=under_contract' },
    { icon: 'verified', label: 'Qualified', value: report.core.qualified, detail: `${percent(report.core.qualified, report.core.leads)} of period leads`, tone: 'blue' as const, href: '/contacts?min_stage=qualified' },
    { icon: 'group_add', label: 'New leads', value: report.core.leads, detail: PERIOD_LABELS[report.period.key], tone: 'teal' as const, href: '/contacts?list=new' },
    { icon: 'mark_chat_unread', label: 'Needs reply', value: report.core.needsReply, detail: 'Unresolved seller conversations', tone: 'red' as const, href: '/conversations?reply=needs_reply' },
  ]

  return (
    <>
      <section aria-label="Company operating metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {cards.map((card) => <ExecutiveMetric key={card.label} {...card} />)}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr_1.15fr]">
        <DepartmentPanel eyebrow="Acquisitions performance" title="Lead-to-contract execution" href="/reports/acquisitions" tone="blue">
          <MiniMetric label="Speed to lead" value={minutes(report.acquisitions.averageSpeedToLeadMinutes)} />
          <MiniMetric label="Appointments recorded" value={available(report.availability.appointments, report.acquisitions.appointmentsRecorded)} />
          <MiniMetric label="Show rate" value={available(report.availability.appointments, nullablePercent(report.acquisitions.appointmentShowRate))} />
          <MiniMetric label="Contracts" value={report.acquisitions.contracts} />
        </DepartmentPanel>
        <DepartmentPanel eyebrow="Dispositions performance" title="Contract-to-close execution" href="/reports/dispositions" tone="red">
          <MiniMetric label="Active deals" value={available(report.availability.dispositions, report.dispositions.activeDeals)} />
          <MiniMetric label="Offers / property" value={available(report.availability.dispositions && report.availability.offers, nullableDecimal(report.dispositions.offersPerProperty))} />
          <MiniMetric label="Avg days to buyer" value={available(report.availability.dispositions && report.availability.offers, nullableDays(report.dispositions.averageDaysToBuyer))} />
          <MiniMetric label="Avg assignment fee" value={available(report.availability.dispositions, nullableMoney(report.dispositions.averageAssignmentFee))} />
        </DepartmentPanel>
        <section className="crm-panel overflow-hidden rounded-2xl">
          <PanelHeading eyebrow="Marketing performance" title="Top recorded lead sources" href="/reports/marketing" />
          <SourceRows rows={report.marketing.sources.slice(0, 5)} compact />
        </section>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr_0.85fr]">
        <FinanceSummary report={report} />
        <BottleneckPanel report={report} />
        <InsightsPanel report={report} />
      </section>
    </>
  )
}

function AcquisitionsView({ report }: { report: OperatingReport }) {
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon="group_add" label="Leads" value={report.acquisitions.total} detail="Created in period" tone="teal" href="/contacts?list=new" />
        <MetricCard icon="schedule" label="Speed to lead" value={minutes(report.acquisitions.averageSpeedToLeadMinutes)} detail="First recorded outbound action" tone="blue" href="/reports/call-sms" />
        <MetricCard icon="event_available" label="Appointments" value={available(report.availability.appointments, report.acquisitions.appointmentsRecorded)} detail={report.availability.appointments ? `${nullablePercent(report.acquisitions.appointmentShowRate)} recorded show rate` : 'Appointment source unavailable'} tone="violet" href="/calendar?department=acquisitions" />
        <MetricCard icon="description" label="Under contract" value={report.acquisitions.contracts} detail={`${percent(report.acquisitions.contracts, report.acquisitions.total)} lead-to-contract`} tone="amber" href="/contacts?min_stage=under_contract" />
        <MetricCard icon="mark_chat_unread" label="Needs reply" value={report.acquisitions.attention.needsReply} detail="Current unresolved attention" tone="red" href="/conversations?reply=needs_reply" />
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.8fr]">
        <FunnelPanel report={report} />
        <BottleneckPanel report={report} acquisitionsOnly />
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Source quality" title="Which sources advance" href="/reports/marketing" /><SourceRows rows={report.marketing.sources} /></section>
        <ActivityPanel report={report} />
      </section>
    </>
  )
}

function MarketingView({ report }: { report: OperatingReport }) {
  const top = report.marketing.sources[0]
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon="campaign" label="Lead sources" value={report.marketing.sources.length} detail="Sources with recorded leads" tone="violet" href="/marketing" />
        <MetricCard icon="group_add" label="Leads" value={report.core.leads} detail="Created in selected period" tone="teal" href="/contacts?list=new" />
        <MetricCard icon="verified" label="Qualified" value={report.core.qualified} detail={`${percent(report.core.qualified, report.core.leads)} qualification rate`} tone="blue" href="/contacts?min_stage=qualified" />
        <MetricCard icon="trophy" label="Top source" value={top ? formatLeadSource(top.source) : 'No data'} detail={top ? `${top.leads} recorded leads` : 'No lead-source records'} tone="green" href="/marketing" />
      </section>
      <section className="crm-panel overflow-hidden rounded-2xl">
        <PanelHeading eyebrow="CRM attribution" title="Lead-source outcomes" href="/marketing" action="Open marketing command center" />
        <SourceRows rows={report.marketing.sources} expanded />
      </section>
      <section className="crm-panel rounded-2xl p-5">
        <p className="crm-eyebrow">Measurement boundary</p>
        <h2 className="mt-1 text-lg font-black">This report shows CRM outcomes, not invented ad-platform economics.</h2>
        <p className="mt-2 text-sm text-[var(--crm-text-muted)]">Spend, CPL, and campaign delivery remain in the marketing command center where Google Ads reporting and CRM attribution are reconciled. This page only displays lead, stage, contract, and revenue records actually attached to a CRM source.</p>
      </section>
    </>
  )
}

function DispositionsView({ report }: { report: OperatingReport }) {
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <MetricCard icon="forum" label="Active deals" value={available(report.availability.dispositions, report.dispositions.activeDeals)} detail={report.availability.dispositions ? 'Not closed or dead' : 'Disposition source unavailable'} tone="blue" href="/dispo/pipeline" />
        <MetricCard icon="sell" label="Offers" value={available(report.availability.offers, report.dispositions.offers)} detail={report.availability.offers ? 'Recorded buyer offers' : 'Offer source unavailable'} tone="green" href="/dispo/offers" />
        <MetricCard icon="speed" label="Days to buyer" value={available(report.availability.dispositions && report.availability.offers, nullableDays(report.dispositions.averageDaysToBuyer))} detail="Entered dispo to accepted offer" tone="coral" href="/dispo/pipeline" />
        <MetricCard icon="payments" label="Assignment revenue" value={available(report.availability.dispositions, money(report.dispositions.assignmentRevenue))} detail="Closed deals with recorded fee" tone="violet" href="/reports/finance" />
        <MetricCard icon="attach_money" label="Avg assignment" value={available(report.availability.dispositions, nullableMoney(report.dispositions.averageAssignmentFee))} detail="Recorded closed fees" tone="green" href="/reports/finance" />
        <MetricCard icon="task_alt" label="Close rate" value={available(report.availability.dispositions, nullablePercent(report.dispositions.closeRate))} detail="Closed / non-dead deals" tone="blue" href="/dispo/pipeline" />
        <MetricCard icon="groups" label="Active buyers" value={available(report.availability.buyers, report.dispositions.activeBuyers)} detail={report.availability.buyers ? 'Buyer records marked active' : 'Buyer source unavailable'} tone="teal" href="/dispo/buyers" />
        <MetricCard icon="history" label="Debriefs due" value={available(report.availability.dispositions, report.dispositions.debriefOutstanding)} detail="Closed loop incomplete" tone="red" href="/dispo/pipeline?closeout=due" />
      </section>
      <section className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
        <DealStagePanel report={report} />
        <RecentClosings report={report} />
      </section>
      <section className="crm-panel rounded-2xl p-5">
        <p className="crm-eyebrow">Post-close operating loop</p>
        <h2 className="mt-1 text-xl font-black">Closeout → financial reconciliation → debrief → workflow improvement</h2>
        <p className="mt-2 max-w-4xl text-sm text-[var(--crm-text-muted)]">A transaction is not operationally complete until the economics are recorded and the debrief is finished. The due count above is attached to closed disposition records whose closeout is incomplete.</p>
        <div className="mt-4 flex flex-wrap gap-2"><Link href="/dispo/pipeline" className="crm-primary-button rounded-lg px-4 py-2.5 text-sm font-black">Open disposition pipeline</Link><Link href="/workflows" className="crm-secondary-button rounded-lg px-4 py-2.5 text-sm font-black">Review closeout workflow</Link></div>
      </section>
    </>
  )
}

function FinanceView({ report }: { report: OperatingReport }) {
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon="payments" label="Gross revenue" value={available(report.availability.finance, money(report.finance.grossRevenue))} detail={report.availability.finance ? `${report.finance.revenueTransactions} recorded transaction${report.finance.revenueTransactions === 1 ? '' : 's'}` : 'Financial source unavailable'} tone="green" href="/dispo/tc?view=reports" />
        <MetricCard icon="receipt_long" label="Expenses" value={available(report.availability.finance, money(report.finance.expenses))} detail="Recorded non-seed expenses" tone="coral" href="/dispo/tc?view=reports" />
        <MetricCard icon="account_balance" label="Net" value={available(report.availability.finance, money(report.finance.netRevenue))} detail="Revenue less expenses" tone={report.finance.netRevenue >= 0 ? 'blue' : 'red'} href="/dispo/tc?view=reports" />
        <MetricCard icon="percent" label="Profit margin" value={available(report.availability.finance, nullablePercent(report.finance.profitMargin))} detail="Net / gross revenue" tone="violet" href="/dispo/tc?view=reports" />
        <MetricCard icon="price_check" label="Avg revenue" value={available(report.availability.finance, nullableMoney(report.finance.averageRevenuePerTransaction))} detail="Per recorded revenue transaction" tone="teal" href="/dispo/tc?view=reports" />
      </section>
      <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <ExpenseCategoryPanel report={report} />
        <TransactionPanel report={report} />
      </section>
    </>
  )
}

function CallSmsView({ report }: { report: OperatingReport }) {
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon="call" label="Calls" value={report.communications.calls} detail="Recorded call activities" tone="blue" href="/dialer?section=analytics" />
        <MetricCard icon="phone_in_talk" label="Connected" value={report.communications.connectedCalls} detail={`${nullablePercent(report.communications.callConnectionRate)} connection rate`} tone="green" href="/dialer?section=conversations" />
        <MetricCard icon="sms" label="SMS" value={report.communications.sms} detail="Inbound and outbound" tone="violet" href="/conversations?channel=sms" />
        <MetricCard icon="north_east" label="SMS sent" value={report.communications.outboundSms} detail="Recorded outbound messages" tone="teal" href="/conversations?channel=sms" />
        <MetricCard icon="south_west" label="SMS received" value={report.communications.inboundSms} detail={`${nullablePercent(report.communications.smsResponseRate)} inbound / outbound`} tone="amber" href="/conversations?channel=sms" />
        <MetricCard icon="mark_chat_unread" label="Needs reply" value={report.core.needsReply} detail="Current unresolved seller attention" tone="red" href="/conversations?reply=needs_reply" />
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <AgentCommunicationTable report={report} />
        <ActivityPanel report={report} />
      </section>
      <section className="flex justify-end"><Link href="/dialer" className="crm-primary-button inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-black">Open dialer <Icon name="arrow_forward" /></Link></section>
    </>
  )
}

function ExecutiveMetric({ icon, label, value, detail, tone, href }: { icon: string; label: string; value: string | number; detail: string; tone: keyof typeof TONES; href: string }) {
  const palette = TONES[tone]
  return (
    <Link href={href} className={`crm-panel group flex min-h-[154px] flex-col rounded-2xl border-t-4 p-4 transition-transform hover:-translate-y-0.5 ${palette.border}`} style={{ borderTopColor: palette.line }}>
      <div className="flex items-start justify-between gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${palette.icon}`}><Icon name={icon} className="text-[20px]" /></span><Icon name="arrow_outward" className="text-[17px] text-[var(--crm-text-muted)] opacity-0 transition-opacity group-hover:opacity-100" /></div>
      <p className="mt-3 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">{label}</p>
      <strong className="mt-1 text-[27px] font-black tracking-[-0.04em] text-[var(--crm-ink)]">{value}</strong>
      <span className="mt-auto pt-2 text-[11px] font-semibold leading-4 text-[var(--crm-text-muted)]">{detail}</span>
    </Link>
  )
}

function MetricCard(props: Parameters<typeof ExecutiveMetric>[0]) {
  return <ExecutiveMetric {...props} />
}

function DepartmentPanel({ eyebrow, title, href, tone, children }: { eyebrow: string; title: string; href: string; tone: keyof typeof TONES; children: React.ReactNode }) {
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow={eyebrow} title={title} href={href} tone={tone} /><div className="grid grid-cols-2 gap-px bg-[var(--crm-border)]">{children}</div></section>
}

function PanelHeading({ eyebrow, title, href, action = 'Open full report', tone = 'red' }: { eyebrow: string; title: string; href: string; action?: string; tone?: keyof typeof TONES }) {
  return <div className="flex items-center justify-between gap-3 border-b border-[var(--crm-border)] px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: TONES[tone].line }}>{eyebrow}</p><h2 className="mt-1 text-base font-black">{title}</h2></div><Link href={href} className="inline-flex items-center gap-1 text-xs font-black text-[var(--crm-info)] hover:underline">{action}<Icon name="arrow_forward" className="text-[16px]" /></Link></div>
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="bg-[var(--crm-surface)] p-4 text-center"><strong className="block text-xl font-black text-[var(--crm-ink)]">{value}</strong><span className="mt-1 block text-[10px] font-bold text-[var(--crm-text-muted)]">{label}</span></div>
}

function FinanceSummary({ report }: { report: OperatingReport }) {
  if (!report.availability.finance) return <SourceUnavailable title="Financial data unavailable" />
  const rows = [
    ['Gross revenue', money(report.finance.grossRevenue)],
    ['Expenses', money(report.finance.expenses)],
    ['Net', money(report.finance.netRevenue)],
    ['Profit margin', nullablePercent(report.finance.profitMargin)],
  ]
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Financial overview" title="Recorded economics" href="/reports/finance" tone="green" /><div className="divide-y divide-[var(--crm-border)] px-5">{rows.map(([label, value]) => <div key={label} className="flex items-center justify-between py-3 text-sm"><span className="font-semibold text-[var(--crm-text-muted)]">{label}</span><strong>{value}</strong></div>)}</div></section>
}

function BottleneckPanel({ report, acquisitionsOnly = false }: { report: OperatingReport; acquisitionsOnly?: boolean }) {
  const rows = report.bottlenecks.filter((row) => !acquisitionsOnly || row.department === 'Acquisitions')
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Active bottlenecks" title="Work constraining results" href="/tasks" tone="amber" /><div className="grid gap-2 p-4 sm:grid-cols-2">{rows.map((row) => <Link key={row.key} href={row.href} className="flex items-center gap-3 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3 hover:border-[var(--crm-brand-border)]"><span className={`h-2.5 w-2.5 rounded-full ${row.severity === 'high' ? 'bg-[var(--crm-brand)]' : row.severity === 'medium' ? 'bg-[#d59600]' : 'bg-[#11a857]'}`} /><span className="min-w-0 flex-1"><strong className="block text-xs">{row.label}</strong><span className="text-[10px] text-[var(--crm-text-muted)]">{row.department}</span></span><strong className="text-lg">{row.count}</strong></Link>)}</div></section>
}

function InsightsPanel({ report }: { report: OperatingReport }) {
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="ARI insights" title="What needs attention" href="/ari" tone="violet" action="Open ARI" /><div className="space-y-3 p-5">{report.insights.map((insight) => <div key={insight} className="flex gap-2 text-xs font-semibold leading-5 text-[var(--crm-text-muted)]"><Icon name="auto_awesome" className="mt-0.5 text-[17px] text-[var(--crm-violet)]" /><span>{insight}</span></div>)}</div></section>
}

function FunnelPanel({ report }: { report: OperatingReport }) {
  const max = Math.max(report.acquisitions.total, 1)
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Acquisition funnel" title="Conversion by operating stage" href="/contacts" tone="blue" action="Open contacts" /><div className="space-y-4 p-5">{report.acquisitions.stages.map((stage) => <Link href={stageHref(stage.key)} key={stage.key} className="grid grid-cols-[115px_1fr_52px] items-center gap-3 text-xs"><span className="font-bold">{stage.label}</span><span className="h-3 overflow-hidden rounded-full bg-[var(--crm-surface-subtle)]"><span className="block h-full rounded-full bg-gradient-to-r from-[#1769e0] to-[#7c3aed]" style={{ width: `${Math.max((stage.value / max) * 100, stage.value > 0 ? 4 : 0)}%` }} /></span><strong className="text-right text-sm">{stage.value}</strong></Link>)}</div></section>
}

function SourceRows({ rows, compact = false, expanded = false }: { rows: OperatingReport['marketing']['sources']; compact?: boolean; expanded?: boolean }) {
  if (rows.length === 0) return <EmptyState icon="campaign" title="No lead-source records" detail="No CRM leads were created in the selected period." />
  return <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Source</th><th className="px-3 py-3 text-right">Leads</th><th className="px-3 py-3 text-right">Qualified</th>{compact ? null : <th className="px-3 py-3 text-right">Contracts</th>}{expanded ? <><th className="px-3 py-3 text-right">Qual. rate</th><th className="px-5 py-3 text-right">Revenue</th></> : null}</tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{rows.map((row) => <tr key={row.source} className="hover:bg-[var(--crm-surface-subtle)]"><td className="px-5 py-3 font-bold">{formatLeadSource(row.source)}</td><td className="px-3 py-3 text-right font-black">{row.leads}</td><td className="px-3 py-3 text-right">{row.qualified}</td>{compact ? null : <td className="px-3 py-3 text-right">{row.contracts}</td>}{expanded ? <><td className="px-3 py-3 text-right">{nullablePercent(row.qualificationRate)}</td><td className="px-5 py-3 text-right font-black text-[#07883f]">{money(row.revenue)}</td></> : null}</tr>)}</tbody></table></div>
}

function ActivityPanel({ report }: { report: OperatingReport }) {
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Communication activity" title="Recorded calls and messages" href="/reports/call-sms" tone="teal" /><div className="grid grid-cols-2 gap-px bg-[var(--crm-border)]"><MiniMetric label="Calls" value={report.communications.calls} /><MiniMetric label="Connected" value={report.communications.connectedCalls} /><MiniMetric label="SMS sent" value={report.communications.outboundSms} /><MiniMetric label="SMS received" value={report.communications.inboundSms} /></div></section>
}

function DealStagePanel({ report }: { report: OperatingReport }) {
  if (!report.availability.dispositions) return <SourceUnavailable title="Disposition data unavailable" />
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Disposition pipeline" title="Deals by stage" href="/dispo/pipeline" /><div className="divide-y divide-[var(--crm-border)] px-5">{report.dispositions.stages.length === 0 ? <EmptyState icon="sell" title="No disposition deals" detail="No deals entered this period." /> : report.dispositions.stages.map(([stage, count]) => <div key={stage} className="flex items-center justify-between py-3"><span className="text-sm font-bold capitalize">{stage.replaceAll('_', ' ')}</span><strong className="rounded-lg bg-[var(--crm-surface-subtle)] px-2.5 py-1 text-sm">{count}</strong></div>)}</div></section>
}

function RecentClosings({ report }: { report: OperatingReport }) {
  if (!report.availability.dispositions) return <SourceUnavailable title="Closing data unavailable" />
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Recent closed assignments" title="Closeout and debrief status" href="/dispo/pipeline" /><div className="overflow-x-auto">{report.dispositions.recentClosings.length === 0 ? <EmptyState icon="task_alt" title="No recorded closings" detail="No disposition deal closed in this period." /> : <table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Property</th><th className="px-3 py-3 text-right">Fee</th><th className="px-3 py-3">Close date</th><th className="px-5 py-3">Debrief</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.dispositions.recentClosings.map((row) => <tr key={row.id}><td className="px-5 py-3"><Link href={`/leads/${row.leadId}`} className="font-bold hover:underline">{row.property}</Link>{row.city ? <span className="block text-[10px] text-[var(--crm-text-muted)]">{row.city}</span> : null}</td><td className="px-3 py-3 text-right font-black">{money(row.assignmentFee)}</td><td className="px-3 py-3">{shortDate(row.closeDate)}</td><td className="px-5 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${row.debriefComplete ? 'bg-[#e8f8ef] text-[#07883f]' : 'bg-[#ffeded] text-[var(--crm-brand)]'}`}>{row.debriefComplete ? 'Complete' : 'Due'}</span></td></tr>)}</tbody></table>}</div></section>
}

function ExpenseCategoryPanel({ report }: { report: OperatingReport }) {
  if (!report.availability.finance) return <SourceUnavailable title="Expense data unavailable" />
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Expense mix" title="Recorded categories" href="/dispo/tc?view=reports" tone="coral" /><div className="space-y-4 p-5">{report.finance.expenseCategories.length === 0 ? <EmptyState icon="receipt_long" title="No recorded expenses" detail="No non-seed expense transactions in this period." /> : report.finance.expenseCategories.map((row) => <div key={row.category}><div className="mb-1.5 flex justify-between text-xs"><span className="font-bold capitalize">{row.category}</span><strong>{money(row.amount)} · {nullablePercent(row.share)}</strong></div><div className="h-2 rounded-full bg-[var(--crm-surface-subtle)]"><div className="h-full rounded-full bg-[#e44c23]" style={{ width: `${row.share ?? 0}%` }} /></div></div>)}</div></section>
}

function TransactionPanel({ report }: { report: OperatingReport }) {
  if (!report.availability.finance) return <SourceUnavailable title="Transaction data unavailable" />
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Ledger activity" title="Recent recorded transactions" href="/dispo/tc?view=reports" tone="green" /><div className="divide-y divide-[var(--crm-border)]">{report.finance.recentTransactions.length === 0 ? <EmptyState icon="account_balance_wallet" title="No recorded transactions" detail="No revenue or non-seed expenses in this period." /> : report.finance.recentTransactions.map((row) => <div key={`${row.type}-${row.id}`} className="flex items-center gap-3 px-5 py-3"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${row.type === 'Revenue' ? 'bg-[#e8f8ef] text-[#07883f]' : 'bg-[#fff0ea] text-[#e44c23]'}`}><Icon name={row.type === 'Revenue' ? 'south_west' : 'north_east'} /></span><span className="min-w-0 flex-1"><strong className="block truncate text-xs">{row.label}</strong><span className="text-[10px] text-[var(--crm-text-muted)]">{shortDate(row.date)} · {row.type}</span></span><strong className={row.type === 'Revenue' ? 'text-[#07883f]' : 'text-[#e44c23]'}>{row.type === 'Expense' ? '−' : '+'}{money(row.amount)}</strong></div>)}</div></section>
}

function AgentCommunicationTable({ report }: { report: OperatingReport }) {
  return <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Agent activity" title="Calls, connections, and messages" href="/dialer?section=analytics" tone="blue" /><div className="overflow-x-auto">{report.communications.agents.length === 0 ? <EmptyState icon="support_agent" title="No agent communication records" detail="No call or SMS activity was recorded in this period." /> : <table className="w-full min-w-[640px] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Agent</th><th className="px-3 py-3 text-right">Calls</th><th className="px-3 py-3 text-right">Connected</th><th className="px-3 py-3 text-right">Connection</th><th className="px-5 py-3 text-right">SMS</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.communications.agents.map((row) => <tr key={row.agent}><td className="px-5 py-3 font-bold">{row.agent}</td><td className="px-3 py-3 text-right">{row.calls}</td><td className="px-3 py-3 text-right">{row.connected}</td><td className="px-3 py-3 text-right">{nullablePercent(row.contactRate)}</td><td className="px-5 py-3 text-right font-black">{row.sms}</td></tr>)}</tbody></table>}</div></section>
}

function CoverageNotice({ report }: { report: OperatingReport }) {
  const unavailable = Object.entries(report.availability).filter(([, available]) => !available).map(([source]) => source)
  if (unavailable.length === 0) return null
  return <div role="status" className="flex items-start gap-3 rounded-xl border border-[#f2c94c] bg-[#fff9e8] px-4 py-3 text-xs font-semibold text-[#765700]"><Icon name="warning" className="mt-0.5 text-[18px]" /><span>Partial data: {unavailable.join(', ')} {unavailable.length === 1 ? 'is' : 'are'} unavailable. Affected panels are intentionally not backfilled with sample values.</span></div>
}

function EmptyState({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return <div className="flex min-h-32 flex-col items-center justify-center px-5 py-7 text-center"><Icon name={icon} className="text-3xl text-[var(--crm-text-muted)]" /><strong className="mt-2 text-sm">{title}</strong><span className="mt-1 text-xs text-[var(--crm-text-muted)]">{detail}</span></div>
}

function SourceUnavailable({ title }: { title: string }) {
  return <section className="crm-panel rounded-2xl"><EmptyState icon="cloud_off" title={title} detail="This panel is not replaced with a sample or zero value." /></section>
}

function ReportSkeleton() {
  return <main aria-label="Loading operating report" className="mx-auto max-w-[1600px] space-y-5 px-5 py-6"><div className="h-20 animate-pulse rounded-2xl bg-[var(--crm-surface-subtle)]" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">{Array.from({ length: 7 }, (_, index) => <div key={index} className="h-40 animate-pulse rounded-2xl bg-[var(--crm-surface-subtle)]" />)}</div><div className="h-80 animate-pulse rounded-2xl bg-[var(--crm-surface-subtle)]" /></main>
}

function ReportError({ onRetry }: { onRetry: () => void }) {
  return <main className="mx-auto max-w-[900px] px-5 py-12"><div className="crm-panel rounded-2xl p-10 text-center"><Icon name="cloud_off" className="text-4xl text-[var(--crm-brand)]" /><h1 className="mt-3 text-xl font-black">Operating data is temporarily unavailable</h1><p className="mt-2 text-sm text-[var(--crm-text-muted)]">The dashboard will not substitute sample data for the missing CRM response.</p><button type="button" onClick={onRetry} className="crm-primary-button mt-5 rounded-lg px-4 py-2.5 text-sm font-black">Try again</button></div></main>
}

function stageHref(key: string) {
  const map: Record<string, string> = { leads: '/contacts', qualified: '/contacts?min_stage=qualified', appointments: '/contacts?min_stage=appointment_set', offers: '/contacts?min_stage=offer_made', contracts: '/contacts?min_stage=under_contract', closed: '/contacts?stage=closed_won' }
  return map[key] ?? '/contacts'
}

function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) }
function nullableMoney(value: number | null) { return value == null ? 'Not recorded' : money(value) }
function percent(numerator: number, denominator: number) { return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : '—' }
function nullablePercent(value: number | null) { return value == null ? 'Not recorded' : `${value}%` }
function nullableDecimal(value: number | null) { return value == null ? 'Not recorded' : value.toFixed(1) }
function nullableDays(value: number | null) { return value == null ? 'Not recorded' : `${value.toFixed(1)}d` }
function minutes(value: number | null) { return value == null ? 'Not recorded' : value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m` }
function shortDate(value: string | null) { return value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded' }
function formatTimestamp(value: string) { return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
function available(condition: boolean, value: string | number) { return condition ? value : 'Unavailable' }
