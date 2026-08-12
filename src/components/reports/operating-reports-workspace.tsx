'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Icon } from '@/components/ui/icon'
import { AcquisitionsMetricsDashboard } from '@/components/reports/acquisitions-metrics-dashboard'
import { ExecutiveDashboard } from '@/components/reports/executive-dashboard'
import { defaultOperatingCustomRange, operatingRangeQuery, ReportDateRangeControl, type OperatingCustomRange } from '@/components/reports/report-date-range-control'
import { formatLeadSource } from '@/lib/contact-display'
import type { OperatingReport, OperatingReportPeriod } from '@/lib/operating-report'

export type OperatingReportView = 'dashboard' | 'marketing' | 'acquisitions' | 'dispositions' | 'finance' | 'call-sms'

const VIEW_COPY: Record<OperatingReportView, { eyebrow: string; title: string; description: string }> = {
  dashboard: { eyebrow: 'SavingKC command center', title: 'CEO Operating System', description: 'A real-time view of attention, pipeline, communication, disposition, and recorded economics.' },
  marketing: { eyebrow: 'Reports · Marketing', title: 'Marketing performance', description: 'Lead-source quality measured by seller records, stage advancement, contracts, and attributed revenue.' },
  acquisitions: { eyebrow: 'Team dashboard · Acquisitions', title: 'Acquisitions performance', description: 'The operating path from new inquiry to opportunity, appointment, contract, and close.' },
  dispositions: { eyebrow: 'Team dashboard · Dispositions', title: 'Dispositions performance', description: 'Buyer demand, offers, contract-to-close execution, assignment economics, and the post-close debrief loop.' },
  finance: { eyebrow: 'Reports · Finance', title: 'Financial performance', description: 'Recorded revenue and expenses only. Seed and sample transactions are excluded.' },
  'call-sms': { eyebrow: 'Reports · Call/SMS', title: 'Call and SMS performance', description: 'Connected calls, messages, response signals, agent activity, and unresolved seller attention.' },
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

function useOperatingReport(period: OperatingReportPeriod, customRange: OperatingCustomRange) {
  return useQuery<OperatingReport>({
    queryKey: ['operating-report', period, customRange.start, customRange.end],
    queryFn: async () => {
      const response = await fetch(`/api/reports/operating?${operatingRangeQuery(period, customRange)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Operating report unavailable')
      return response.json() as Promise<OperatingReport>
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function OperatingReportsWorkspace({ view }: { view: OperatingReportView }) {
  const [period, setPeriod] = useState<OperatingReportPeriod>('30d')
  const [customRange, setCustomRange] = useState<OperatingCustomRange>(defaultOperatingCustomRange)
  const { data, error, isLoading, isFetching, refetch } = useOperatingReport(period, customRange)
  const copy = VIEW_COPY[view]

  if (view === 'dashboard') {
    if (isLoading) return <ReportSkeleton copy={copy} />
    if (error || !data) return <ReportError onRetry={() => void refetch()} />
    return <ExecutiveDashboard report={data} period={period} customRange={customRange} onPeriodChange={setPeriod} onCustomRangeChange={setCustomRange} isFetching={isFetching} />
  }

  return (
    <main className="mx-auto w-full max-w-[1720px] space-y-3 px-3 py-4 pb-24 sm:px-5 lg:px-6">
      <header className="flex flex-col gap-3 rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-5 py-4 shadow-[var(--crm-shadow-sm)] xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="crm-eyebrow">{copy.eyebrow}</p>
          <h1 className="mt-1 text-[25px] font-black tracking-[-0.035em] text-[var(--crm-ink)]">{copy.title}</h1>
          <p className="mt-0.5 max-w-4xl text-xs font-medium text-[var(--crm-text-muted)]">{copy.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'marketing' ? (
            <Link href="/marketing/google-ads" className="crm-primary-button inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-black">
              <Icon name="ads_click" className="text-[18px]" />
              Google Ads
            </Link>
          ) : null}
          {view === 'dispositions' ? (
            <>
              <Link href="/dispo/pipeline" className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-black">
                <Icon name="route" className="text-[18px]" />
                Dispositions portal
              </Link>
              <Link href="/dispo/tc" className="crm-primary-button inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-black">
                <Icon name="fact_check" className="text-[18px]" />
                Closing coordination
              </Link>
            </>
          ) : null}
          <ReportDateRangeControl period={period} customRange={customRange} onPeriodChange={setPeriod} onCustomRangeChange={setCustomRange} />
          <span className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black ${data ? 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : error ? 'border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>
            <span className={`h-2 w-2 rounded-full ${data ? 'bg-[#11a857]' : error ? 'bg-[var(--crm-danger)]' : 'bg-[var(--crm-text-dim)]'} ${isFetching ? 'animate-pulse' : ''}`} />
            {data ? `Live CRM · ${formatTimestamp(data.generatedAt)}` : error ? 'CRM data unavailable' : 'Loading CRM data'}
          </span>
        </div>
      </header>

      {isLoading ? <ReportPanelSkeleton /> : error || !data ? <ReportErrorPanel onRetry={() => void refetch()} /> : (
        <>
          <CoverageNotice report={data} />
          {view === 'acquisitions' ? <AcquisitionsView report={data} /> : null}
          {view === 'marketing' ? <MarketingView report={data} /> : null}
          {view === 'dispositions' ? <DispositionsView report={data} /> : null}
          {view === 'finance' ? <FinanceView report={data} /> : null}
          {view === 'call-sms' ? <CallSmsView report={data} /> : null}
        </>
      )}
    </main>
  )
}

function AcquisitionsView({ report }: { report: OperatingReport }) {
  return <AcquisitionsMetricsDashboard report={report} />
}

function MarketingView({ report }: { report: OperatingReport }) {
  const top = report.marketing.sources[0]
  return (
    <>
      <NumberedPanel number="1" title="Core marketing metrics" hint="CRM-attributed outcomes">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon="campaign" label="Lead sources" value={report.marketing.sources.length} numericValue={report.marketing.sources.length} detail="Sources with recorded leads" tone="violet" href="/reports/marketing" />
          <MetricCard icon="group_add" label="Leads" value={report.core.leads} numericValue={report.core.leads} detail="Created in selected period" tone="teal" href="/contacts?list=new" series={report.trends.leads} />
          <MetricCard icon="verified" label="Opportunities" value={report.core.qualified} numericValue={report.core.qualified} detail={`${percent(report.core.qualified, report.core.leads)} opportunity rate`} tone="blue" href="/contacts?min_stage=qualified" series={report.trends.qualified} goal={scaledGoal(report.goals.weeklyQualified, report, 'weekly')} />
          <MetricCard icon="trophy" label="Top source" value={top ? formatLeadSource(top.source) : 'No data'} numericValue={top?.leads ?? null} detail={top ? `${top.leads} recorded leads` : 'No lead-source records'} tone="green" href="/reports/marketing" />
        </div>
      </NumberedPanel>
      <section className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]">
        <NumberedPanel number="2" title="Lead-source outcomes" hint="Leads, qualification, contracts, and revenue" actionHref="/reports/marketing"><SourceRows rows={report.marketing.sources} expanded /></NumberedPanel>
        <NumberedPanel number="3" title="Source mix" hint="Share of recorded leads"><SourceMix report={report} /></NumberedPanel>
      </section>
      <section className="grid gap-3 xl:grid-cols-[1fr_1fr]">
        <NumberedPanel number="4" title="Marketing-to-contract funnel" actionHref="/contacts"><FunnelContent report={report} /></NumberedPanel>
        <NumberedPanel number="5" title="Marketing insights" actionHref="/ari"><InsightRows report={report} /></NumberedPanel>
      </section>
      <section className="crm-panel flex flex-col gap-3 rounded-2xl px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="crm-eyebrow">Measurement boundary</p><h2 className="mt-1 text-sm font-black">CRM outcomes here; ad-platform economics stay in the Marketing command center.</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Spend, CPL, campaign delivery, and conversion-export health are never backfilled with sample values on this report.</p></div>
        <Link href="/marketing/google-ads" className="crm-secondary-button inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-black">Open Google Ads metrics <Icon name="arrow_forward" /></Link>
      </section>
    </>
  )
}

function DispositionsView({ report }: { report: OperatingReport }) {
  return (
    <>
      <section className="crm-panel grid gap-4 rounded-2xl px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div><p className="crm-eyebrow">Department health</p><h2 className="mt-1 text-lg font-black">Disposition operating health</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Calculated only from recorded offer coverage, close rate, buyer participation, and completed closeout debriefs.</p></div>
        <div className="flex items-center gap-5"><ScoreRing score={report.dispositions.healthScore} label="Disposition health" tone="green" /><div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[10px] font-bold text-[var(--crm-text-muted)]"><ScoreLegend label="Buyer activity" value={report.dispositions.activeBuyers} tone="teal" /><ScoreLegend label="Offer coverage" value={report.dispositions.offerCoverage} suffix="%" tone="green" /><ScoreLegend label="Close rate" value={report.dispositions.closeRate} suffix="%" tone="blue" /><ScoreLegend label="Debriefs complete" value={report.dispositions.debriefCompletion} suffix="%" tone="violet" /></div></div>
      </section>

      <NumberedPanel number="1" title="Core disposition metrics" hint="Recorded in the selected period">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          <MetricCard icon="forum" label="Active deals" value={available(report.availability.dispositions, report.dispositions.activeDeals)} numericValue={report.dispositions.activeDeals} detail="Not closed or dead" tone="blue" href="/dispo/pipeline" series={report.trends.activeDeals} />
          <MetricCard icon="sell" label="Offers / property" value={available(report.availability.offers, nullableDecimal(report.dispositions.offersPerProperty))} numericValue={report.dispositions.offersPerProperty} detail={`${report.dispositions.offers} recorded offers`} tone="green" href="/dispo/offers" />
          <MetricCard icon="speed" label="Days to buyer" value={available(report.availability.dispositions && report.availability.offers, nullableDays(report.dispositions.averageDaysToBuyer))} numericValue={report.dispositions.averageDaysToBuyer} detail="Entered dispo to accepted offer" tone="coral" href="/dispo/pipeline" />
          <MetricCard icon="payments" label="Assignment revenue" value={available(report.availability.dispositions, money(report.dispositions.assignmentRevenue))} numericValue={report.dispositions.assignmentRevenue} detail="Recorded closed assignment fees" tone="violet" href="/reports/finance" series={report.trends.assignmentRevenue} />
          <MetricCard icon="attach_money" label="Avg assignment fee" value={available(report.availability.dispositions, nullableMoney(report.dispositions.averageAssignmentFee))} numericValue={report.dispositions.averageAssignmentFee} detail="Across recorded closed fees" tone="green" href="/reports/finance" />
          <MetricCard icon="task_alt" label="Close rate" value={available(report.availability.dispositions, nullablePercent(report.dispositions.closeRate))} numericValue={report.dispositions.closeRate} detail="Closed / non-dead deals" tone="blue" href="/dispo/pipeline" />
          <MetricCard icon="groups" label="Active buyers" value={available(report.availability.buyers, report.dispositions.activeBuyers)} numericValue={report.dispositions.activeBuyers} detail="Buyer records marked active" tone="teal" href="/dispo/buyers" series={report.trends.buyers} />
          <MetricCard icon="history" label="Debriefs due" value={available(report.availability.dispositions, report.dispositions.debriefOutstanding)} numericValue={report.dispositions.debriefOutstanding} detail="Closed loop incomplete" tone="red" href="/dispo/pipeline?closeout=due" />
        </div>
      </NumberedPanel>

      <section className="grid gap-3 xl:grid-cols-[0.82fr_0.88fr_1.3fr]">
        <NumberedPanel number="2" title="Buyer demand score" hint="North-star indicator"><DemandScore report={report} /></NumberedPanel>
        <NumberedPanel number="3" title="Recorded activity" hint="Selected period"><DispositionActivity report={report} /></NumberedPanel>
        <NumberedPanel number="4" title="Offer management" hint="Active properties" actionHref="/dispo/offers"><OfferManagementTable report={report} /></NumberedPanel>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.08fr_0.72fr_0.8fr_1.25fr]">
        <NumberedPanel number="5" title="Buyer pipeline"><BuyerPipeline report={report} /></NumberedPanel>
        <NumberedPanel number="6" title="Buyer health"><BuyerHealth report={report} /></NumberedPanel>
        <NumberedPanel number="7" title="Negotiation performance"><NegotiationPerformance report={report} /></NumberedPanel>
        <NumberedPanel number="8" title="Recent closed assignments" actionHref="/dispo/pipeline"><RecentClosings report={report} embedded /></NumberedPanel>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <NumberedPanel number="9" title="Active bottlenecks" actionHref="/tasks"><BottleneckRows report={report} /></NumberedPanel>
        <NumberedPanel number="10" title="ARI disposition insights" actionHref="/ari"><InsightRows report={report} /></NumberedPanel>
      </section>
    </>
  )
}

function FinanceView({ report }: { report: OperatingReport }) {
  return (
    <>
      <NumberedPanel number="1" title="Core financial metrics" hint="Non-seed transactions only">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon="payments" label="Gross revenue" value={available(report.availability.finance, money(report.finance.grossRevenue))} numericValue={report.finance.grossRevenue} detail={`${report.finance.revenueTransactions} recorded transaction${report.finance.revenueTransactions === 1 ? '' : 's'}`} tone="green" href="/dispo/tc?view=reports" series={report.trends.revenue} goal={scaledGoal(report.goals.monthlyRevenue, report, 'monthly')} />
          <MetricCard icon="receipt_long" label="Expenses" value={available(report.availability.finance, money(report.finance.expenses))} numericValue={report.finance.expenses} detail="Recorded non-seed expenses" tone="coral" href="/dispo/tc?view=reports" series={report.trends.expenses} />
          <MetricCard icon="account_balance" label="Net" value={available(report.availability.finance, money(report.finance.netRevenue))} numericValue={report.finance.netRevenue} detail="Revenue less expenses" tone={report.finance.netRevenue >= 0 ? 'blue' : 'red'} href="/dispo/tc?view=reports" series={report.trends.net} />
          <MetricCard icon="percent" label="Profit margin" value={available(report.availability.finance, nullablePercent(report.finance.profitMargin))} numericValue={report.finance.profitMargin} detail="Net / gross revenue" tone="violet" href="/dispo/tc?view=reports" series={report.trends.profitMargin} />
          <MetricCard icon="price_check" label="Avg revenue" value={available(report.availability.finance, nullableMoney(report.finance.averageRevenuePerTransaction))} numericValue={report.finance.averageRevenuePerTransaction} detail="Per recorded revenue transaction" tone="teal" href="/dispo/tc?view=reports" />
        </div>
      </NumberedPanel>
      <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <NumberedPanel number="2" title="Revenue and expense trend" hint="Recorded transaction dates"><FinancialTrend report={report} /></NumberedPanel>
        <NumberedPanel number="3" title="Expense mix" actionHref="/dispo/tc?view=reports"><ExpenseMix report={report} /></NumberedPanel>
      </section>
      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <NumberedPanel number="4" title="Recent recorded transactions" actionHref="/dispo/tc?view=reports"><TransactionRows report={report} /></NumberedPanel>
        <NumberedPanel number="5" title="Financial operating readout"><FinancialReadout report={report} /></NumberedPanel>
      </section>
    </>
  )
}

function CallSmsView({ report }: { report: OperatingReport }) {
  return (
    <>
      <NumberedPanel number="1" title="Core communication metrics" hint="Recorded call and message events">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard icon="call" label="Calls" value={report.communications.calls} numericValue={report.communications.calls} detail="Recorded call activities" tone="blue" href="/dialer?section=analytics" series={report.trends.calls} goal={scaledGoal(report.goals.dailyCalls, report, 'daily')} />
          <MetricCard icon="phone_in_talk" label="Connected" value={report.communications.connectedCalls} numericValue={report.communications.connectedCalls} detail={`${nullablePercent(report.communications.callConnectionRate)} connection rate`} tone="green" href="/dialer?section=conversations" series={report.trends.connectedCalls} />
          <MetricCard icon="sms" label="SMS" value={report.communications.sms} numericValue={report.communications.sms} detail={`${report.communications.outboundSms} sent · ${report.communications.inboundSms} received${report.communications.unclassifiedSms > 0 ? ` · ${report.communications.unclassifiedSms} direction unrecorded` : ''}`} tone="violet" href="/conversations?channel=sms" series={report.trends.sms} />
          <MetricCard icon="north_east" label="SMS sent" value={report.communications.outboundSms} numericValue={report.communications.outboundSms} detail="Recorded outbound messages" tone="teal" href="/conversations?channel=sms" series={report.trends.outboundSms} />
          <MetricCard icon="south_west" label="SMS received" value={report.communications.inboundSms} numericValue={report.communications.inboundSms} detail={`${nullablePercent(report.communications.smsResponseRate)} inbound / outbound`} tone="amber" href="/conversations?channel=sms" series={report.trends.inboundSms} />
          <MetricCard icon="mark_chat_unread" label="Needs reply" value={report.core.needsReply} numericValue={report.core.needsReply} detail="Current unresolved seller attention" tone="red" href="/conversations?reply=needs_reply" />
        </div>
      </NumberedPanel>
      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <NumberedPanel number="2" title="Call and SMS trend"><CommunicationTrend report={report} /></NumberedPanel>
        <NumberedPanel number="3" title="Channel activity"><ActivityGrid report={report} /></NumberedPanel>
      </section>
      <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <NumberedPanel number="4" title="Agent activity" actionHref="/dialer?section=analytics"><AgentTableRows report={report} /></NumberedPanel>
        <NumberedPanel number="5" title="Unresolved attention" actionHref="/conversations?reply=needs_reply"><CommunicationAttention report={report} /></NumberedPanel>
      </section>
      <section className="flex justify-end"><Link href="/dialer" className="crm-primary-button inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-black">Open dialer <Icon name="arrow_forward" /></Link></section>
    </>
  )
}

type MetricProps = {
  icon: string
  label: string
  value: string | number
  numericValue?: number | null
  detail: string
  tone: keyof typeof TONES
  href: string
  series?: OperatingReport['trends']['leads']
  goal?: number | null
}

function ExecutiveMetric({ icon, label, value, numericValue = null, detail, tone, href, series, goal = null }: MetricProps) {
  const palette = TONES[tone]
  const movement = series ? seriesMomentum(series) : null
  const progress = goal != null && goal > 0 && numericValue != null ? Math.min(100, Math.max(0, Math.round((numericValue / goal) * 100))) : null
  return (
    <Link href={href} className={`crm-panel group flex min-h-[178px] flex-col overflow-hidden rounded-2xl border-t-[3px] p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--crm-shadow-md)] ${palette.border}`} style={{ borderTopColor: palette.line }}>
      <div className="flex items-center gap-2.5"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${palette.icon}`}><Icon name={icon} className="text-[18px]" /></span><p className="min-w-0 flex-1 text-[10px] font-black uppercase leading-4 tracking-[0.065em] text-[var(--crm-text-muted)]">{label}</p><Icon name="arrow_outward" className="text-[15px] text-[var(--crm-text-dim)] opacity-0 transition-opacity group-hover:opacity-100" /></div>
      <strong className="mt-2 text-[25px] font-black tracking-[-0.045em] text-[var(--crm-ink)]">{value}</strong>
      <span className="mt-0.5 min-h-7 text-[10px] font-semibold leading-3.5 text-[var(--crm-text-muted)]">{detail}</span>
      <div className="mt-auto pt-1.5">
        {series ? <Sparkline series={series} color={palette.line} label={`${label} recorded trend`} /> : null}
        <div className="mt-1 flex items-center justify-between gap-2 text-[9px] font-bold">
          <span className={series == null || movement == null ? 'text-[var(--crm-text-dim)]' : movement >= 0 ? 'text-[var(--crm-success)]' : 'text-[var(--crm-danger)]'}>{series == null ? 'Live CRM snapshot' : movement == null ? 'No prior activity' : `${movement >= 0 ? '↑' : '↓'} ${Math.abs(movement)}% vs prior half`}</span>
          {goal != null ? <span className="text-[var(--crm-text-dim)]">Goal {compactNumber(goal)}</span> : null}
        </div>
        {progress != null ? <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--crm-surface-subtle)]"><span className="block h-full rounded-full" style={{ width: `${progress}%`, background: palette.line }} /></div> : null}
      </div>
    </Link>
  )
}

function MetricCard(props: Parameters<typeof ExecutiveMetric>[0]) {
  return <ExecutiveMetric {...props} />
}

function Sparkline({ series, color, label }: { series: OperatingReport['trends']['leads']; color: string; label: string }) {
  const values = series.map((point) => point.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 138},${28 - ((value - min) / span) * 24}`).join(' ')
  return <svg role="img" aria-label={label} viewBox="0 0 138 32" className="h-7 w-full overflow-visible"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>
}

function NumberedPanel({ number, title, hint, actionHref, children }: { number: string; title: string; hint?: string; actionHref?: string; children: React.ReactNode }) {
  return <section className="crm-panel min-w-0 overflow-hidden rounded-2xl"><header className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--crm-border)] px-4 py-3"><div className="flex min-w-0 items-center gap-2"><span className="text-sm font-black text-[#1769e0]">{number}.</span><h2 className="truncate text-xs font-black uppercase tracking-[0.04em] text-[var(--crm-ink)]">{title}</h2>{hint ? <span className="hidden text-[10px] font-semibold text-[var(--crm-text-muted)] sm:inline">({hint})</span> : null}</div>{actionHref ? <Link href={actionHref} className="inline-flex shrink-0 items-center gap-1 text-[10px] font-black text-[var(--crm-info)] hover:underline">View all <Icon name="arrow_forward" className="text-sm" /></Link> : null}</header><div className="p-3">{children}</div></section>
}

function ScoreRing({ score, label, tone }: { score: number | null; label: string; tone: keyof typeof TONES }) {
  const value = score ?? 0
  const color = TONES[tone].line
  return <div className="flex items-center gap-3"><div role="img" aria-label={`${label}: ${score == null ? 'not recorded' : `${score}%`}`} className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${color} ${value * 3.6}deg, var(--crm-surface-subtle) 0deg)` }}><div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--crm-surface)]"><span style={{ color }}><Icon name={score == null ? 'data_alert' : 'favorite'} className="text-[21px]" /></span></div></div><div><span className="block text-[10px] font-bold text-[var(--crm-text-muted)]">{label}</span><strong className="text-2xl font-black" style={{ color }}>{score == null ? 'Not recorded' : `${score}%`}</strong></div></div>
}

function ScoreLegend({ label, value, suffix = '', tone }: { label: string; value: number | null; suffix?: string; tone: keyof typeof TONES }) {
  return <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: TONES[tone].line }} /><span>{label}</span><strong className="text-[var(--crm-ink)]">{value == null ? '—' : `${Math.round(value)}${suffix}`}</strong></div>
}

function DemandScore({ report }: { report: OperatingReport }) {
  const factors = [
    ['Offers per property', nullableDecimal(report.dispositions.offersPerProperty)],
    ['Offer coverage', nullablePercent(report.dispositions.offerCoverage)],
    ['Active buyers', String(report.dispositions.activeBuyers)],
    ['Days to buyer', nullableDays(report.dispositions.averageDaysToBuyer)],
  ]
  return <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center"><ScoreRing score={report.dispositions.buyerDemandScore} label="Demand score" tone={report.dispositions.buyerDemandScore != null && report.dispositions.buyerDemandScore >= 70 ? 'green' : 'amber'} /><div className="divide-y divide-[var(--crm-border)]">{factors.map(([label, value]) => <DataRow key={label} label={label} value={value} />)}</div></div>
}

function DispositionActivity({ report }: { report: OperatingReport }) {
  const rows = [
    { icon: 'sell', label: 'Buyer offers', value: report.dispositions.offers, tone: 'green' as const },
    { icon: 'groups', label: 'Active buyers', value: report.dispositions.activeBuyers, tone: 'teal' as const },
    { icon: 'task_alt', label: 'Closed deals', value: report.dispositions.closedDeals, tone: 'blue' as const },
    { icon: 'history', label: 'Debriefs due', value: report.dispositions.debriefOutstanding, tone: 'red' as const },
  ]
  return <div className="grid grid-cols-2 gap-2">{rows.map((row) => <div key={row.label} className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3 text-center"><span className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full ${TONES[row.tone].icon}`}><Icon name={row.icon} className="text-[17px]" /></span><strong className="mt-2 block text-xl font-black">{row.value}</strong><span className="text-[9px] font-bold text-[var(--crm-text-muted)]">{row.label}</span></div>)}</div>
}

function OfferManagementTable({ report }: { report: OperatingReport }) {
  if (report.dispositions.offerManagement.length === 0) return <EmptyState icon="sell" title="No active disposition properties" detail="There are no active deal records in this period." />
  return <div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-[10px]"><thead className="text-[9px] uppercase tracking-[0.05em] text-[var(--crm-text-muted)]"><tr><th className="pb-2">Property</th><th className="pb-2 text-right">Offers</th><th className="pb-2 text-right">Highest</th><th className="pb-2 text-right">Accepted</th><th className="pb-2 text-right">Days</th><th className="pb-2 text-right">Status</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.dispositions.offerManagement.map((row) => <tr key={row.id}><td className="py-2 pr-3"><Link href={`/leads/${row.leadId}`} className="font-black hover:underline">{row.property}</Link>{row.city ? <span className="block text-[9px] text-[var(--crm-text-muted)]">{row.city}</span> : null}</td><td className="py-2 text-right font-black">{row.offers}</td><td className="py-2 text-right">{row.highestOffer == null ? '—' : money(row.highestOffer)}</td><td className="py-2 text-right">{row.bestOffer == null ? '—' : money(row.bestOffer)}</td><td className="py-2 text-right">{row.daysOnMarket ?? '—'}</td><td className="py-2 text-right"><StatusPill value={row.stage} /></td></tr>)}</tbody></table></div>
}

function BuyerPipeline({ report }: { report: OperatingReport }) {
  const max = Math.max(report.dispositions.buyerFunnel[0]?.value ?? 0, 1)
  const colors = ['#1769e0', '#0d9c56', '#f0a400', '#c8242d']
  return <div className="space-y-1.5">{report.dispositions.buyerFunnel.map((row, index) => <div key={row.key} className="mx-auto flex h-9 items-center justify-between px-4 text-[10px] font-black text-white" style={{ width: `${Math.max(48, (row.value / max) * 100)}%`, background: colors[index], clipPath: 'polygon(4% 0,96% 0,90% 100%,10% 100%)' }}><span>{row.label}</span><strong>{row.value}</strong></div>)}</div>
}

function BuyerHealth({ report }: { report: OperatingReport }) {
  const rows = [
    ['Active buyers', report.dispositions.activeBuyers],
    ['Repeat buyers', report.dispositions.repeatBuyers],
    ['VIP buyers', report.dispositions.vipBuyers],
    ['Inactive buyers', report.dispositions.inactiveBuyers],
    ['Repeat closings', report.dispositions.repeatBuyerClosings],
  ] as Array<[string, string | number]>
  return <div className="divide-y divide-[var(--crm-border)]">{rows.map(([label, value]) => <DataRow key={label} label={label} value={value} />)}</div>
}

function NegotiationPerformance({ report }: { report: OperatingReport }) {
  const multiOfferProperties = report.dispositions.offerManagement.filter((row) => row.offers > 1).length
  const rows = [
    ['Offers / property', nullableDecimal(report.dispositions.offersPerProperty)],
    ['Properties with 2+ offers', multiOfferProperties],
    ['Offer coverage', nullablePercent(report.dispositions.offerCoverage)],
    ['Close rate', nullablePercent(report.dispositions.closeRate)],
    ['Avg. days to buyer', nullableDays(report.dispositions.averageDaysToBuyer)],
  ] as Array<[string, string | number]>
  return <div className="divide-y divide-[var(--crm-border)]">{rows.map(([label, value]) => <DataRow key={label} label={label} value={value} />)}</div>
}

function BottleneckRows({ report, acquisitionsOnly = false }: { report: OperatingReport; acquisitionsOnly?: boolean }) {
  const rows = report.bottlenecks.filter((row) => !acquisitionsOnly || row.department === 'Acquisitions')
  return <div className="grid gap-2 sm:grid-cols-2">{rows.map((row) => <Link key={row.key} href={row.href} className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3 hover:border-[var(--crm-brand-border)]"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${row.severity === 'high' ? 'bg-[var(--crm-brand)]' : row.severity === 'medium' ? 'bg-[#d59600]' : 'bg-[#11a857]'}`} /><strong className="min-w-0 flex-1 truncate text-[11px]">{row.label}</strong><strong className="text-lg">{row.count}</strong></div><div className="mt-1 flex justify-between text-[9px] text-[var(--crm-text-muted)]"><span>{row.department}</span><span>{row.severity === 'clear' ? 'Clear' : row.severity}</span></div></Link>)}</div>
}

function InsightRows({ report }: { report: OperatingReport }) {
  return <div className="space-y-2.5">{report.insights.map((insight) => <div key={insight} className="flex gap-2 rounded-lg bg-[var(--crm-violet-soft)] px-3 py-2 text-[10px] font-semibold leading-4 text-[var(--crm-text)]"><Icon name="auto_awesome" className="mt-0.5 text-base text-[var(--crm-violet)]" /><span>{insight}</span></div>)}</div>
}

function FunnelContent({ report }: { report: OperatingReport }) {
  const max = Math.max(report.acquisitions.total, 1)
  const colors = ['#1769e0', '#6d4cb3', '#0d9c56', '#f0a400', '#ef6b2e', '#c8242d']
  return <div className="grid gap-2">{report.acquisitions.stages.map((stage, index) => <Link href={stageHref(stage.key)} key={stage.key} className="grid grid-cols-[92px_1fr_42px_45px] items-center gap-2 text-[10px]"><span className="font-black">{stage.label}</span><span className="h-7 overflow-hidden rounded-md bg-[var(--crm-surface-subtle)]"><span className="flex h-full items-center rounded-md px-2 font-black text-white" style={{ width: `${Math.max((stage.value / max) * 100, stage.value > 0 ? 9 : 0)}%`, background: colors[index] }}>{stage.value > 0 ? stage.value : ''}</span></span><strong className="text-right">{stage.value}</strong><span className="text-right font-bold text-[var(--crm-text-muted)]">{index === 0 ? '100%' : percent(stage.value, report.acquisitions.stages[index - 1].value)}</span></Link>)}</div>
}

function ActivityGrid({ report }: { report: OperatingReport }) {
  const rows = [
    ['Calls', report.communications.calls, 'call', 'blue'],
    ['Connected', report.communications.connectedCalls, 'phone_in_talk', 'green'],
    ['SMS sent', report.communications.outboundSms, 'north_east', 'teal'],
    ['SMS received', report.communications.inboundSms, 'south_west', 'amber'],
  ] as Array<[string, number, string, keyof typeof TONES]>
  return <div className="grid grid-cols-2 gap-2">{rows.map(([label, value, icon, tone]) => <div key={label} className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3"><div className="flex items-center gap-2"><span className={`flex h-8 w-8 items-center justify-center rounded-full ${TONES[tone].icon}`}><Icon name={icon} className="text-base" /></span><span className="text-[10px] font-bold text-[var(--crm-text-muted)]">{label}</span></div><strong className="mt-2 block text-2xl font-black">{value}</strong></div>)}</div>
}

function SourceMix({ report }: { report: OperatingReport }) {
  const total = Math.max(report.marketing.sources.reduce((sum, row) => sum + row.leads, 0), 1)
  const colors = ['#1769e0', '#6d4cb3', '#0d9c56', '#ef6b2e', '#d59600', '#087f7b']
  return <div className="space-y-3">{report.marketing.sources.slice(0, 6).map((row, index) => <div key={row.source}><div className="mb-1 flex items-center justify-between text-[10px]"><span className="font-bold">{formatLeadSource(row.source)}</span><strong>{row.leads} · {Math.round((row.leads / total) * 100)}%</strong></div><div className="h-2 rounded-full bg-[var(--crm-surface-subtle)]"><span className="block h-full rounded-full" style={{ width: `${(row.leads / total) * 100}%`, background: colors[index] }} /></div></div>)}</div>
}

function FinancialTrend({ report }: { report: OperatingReport }) {
  return <TrendComparisonChart primary={report.trends.revenue} secondary={report.trends.expenses} primaryLabel="Revenue" secondaryLabel="Expenses" primaryColor="#0d9c56" secondaryColor="#ef6b2e" formatter={money} />
}

function ExpenseMix({ report }: { report: OperatingReport }) {
  if (report.finance.expenseCategories.length === 0) return <EmptyState icon="receipt_long" title="No recorded expenses" detail="No non-seed expense transactions in this period." />
  return <div className="space-y-3">{report.finance.expenseCategories.map((row) => <div key={row.category}><div className="mb-1 flex justify-between text-[10px]"><span className="font-bold capitalize">{row.category}</span><strong>{money(row.amount)} · {nullablePercent(row.share)}</strong></div><div className="h-2 rounded-full bg-[var(--crm-surface-subtle)]"><span className="block h-full rounded-full bg-[#ef6b2e]" style={{ width: `${row.share ?? 0}%` }} /></div></div>)}</div>
}

function TransactionRows({ report }: { report: OperatingReport }) {
  if (report.finance.recentTransactions.length === 0) return <EmptyState icon="account_balance_wallet" title="No recorded transactions" detail="No revenue or non-seed expenses in this period." />
  return <div className="divide-y divide-[var(--crm-border)]">{report.finance.recentTransactions.map((row) => <div key={`${row.type}-${row.id}`} className="flex items-center gap-3 py-2"><span className={`flex h-8 w-8 items-center justify-center rounded-full ${row.type === 'Revenue' ? TONES.green.icon : TONES.coral.icon}`}><Icon name={row.type === 'Revenue' ? 'south_west' : 'north_east'} className="text-base" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-[10px]">{row.label}</strong><span className="text-[9px] text-[var(--crm-text-muted)]">{shortDate(row.date)} · {row.type}</span></span><strong className={`text-xs ${row.type === 'Revenue' ? 'text-[var(--crm-success)]' : 'text-[#ef6b2e]'}`}>{row.type === 'Expense' ? '−' : '+'}{money(row.amount)}</strong></div>)}</div>
}

function FinancialReadout({ report }: { report: OperatingReport }) {
  const goal = scaledGoal(report.goals.monthlyRevenue, report, 'monthly')
  const rows = [
    ['Revenue goal', goal == null ? 'Not configured' : money(goal)],
    ['Goal progress', goal == null ? '—' : percent(report.finance.grossRevenue, goal)],
    ['Profit margin', nullablePercent(report.finance.profitMargin)],
    ['Average transaction', nullableMoney(report.finance.averageRevenuePerTransaction)],
    ['Recorded transactions', report.finance.revenueTransactions],
  ] as Array<[string, string | number]>
  return <div className="divide-y divide-[var(--crm-border)]">{rows.map(([label, value]) => <DataRow key={label} label={label} value={value} />)}</div>
}

function CommunicationTrend({ report }: { report: OperatingReport }) {
  return <TrendComparisonChart primary={report.trends.calls} secondary={report.trends.sms} primaryLabel="Calls" secondaryLabel="SMS" primaryColor="#1769e0" secondaryColor="#6d4cb3" formatter={(value) => String(value)} />
}

function AgentTableRows({ report }: { report: OperatingReport }) {
  if (report.communications.agents.length === 0) return <EmptyState icon="support_agent" title="No agent communication records" detail="No call or SMS activity was recorded in this period." />
  return <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-[10px]"><thead className="text-[9px] uppercase tracking-[0.05em] text-[var(--crm-text-muted)]"><tr><th className="pb-2">Agent</th><th className="pb-2 text-right">Calls</th><th className="pb-2 text-right">Connected</th><th className="pb-2 text-right">Connection</th><th className="pb-2 text-right">SMS</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.communications.agents.map((row) => <tr key={row.agent}><td className="py-2 font-black">{row.agent}</td><td className="py-2 text-right">{row.calls}</td><td className="py-2 text-right">{row.connected}</td><td className="py-2 text-right">{nullablePercent(row.contactRate)}</td><td className="py-2 text-right font-black">{row.sms}</td></tr>)}</tbody></table></div>
}

function CommunicationAttention({ report }: { report: OperatingReport }) {
  const unclassifiedSms = Math.max(0, report.communications.sms - report.communications.inboundSms - report.communications.outboundSms)
  const rows = [
    ['Needs reply', report.core.needsReply, report.core.needsReply > 0 ? 'red' : 'green'],
    ['Calls not connected', Math.max(0, report.communications.calls - report.communications.connectedCalls), 'amber'],
    ['Voicemails', report.communications.voicemail, 'violet'],
    ['SMS without direction', unclassifiedSms, unclassifiedSms > 0 ? 'amber' : 'green'],
  ] as Array<[string, number, keyof typeof TONES]>
  return <div className="space-y-2">{rows.map(([label, value, tone]) => <div key={label} className="flex items-center gap-3 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TONES[tone].line }} /><span className="flex-1 text-[10px] font-bold">{label}</span><strong className="text-lg">{value}</strong></div>)}</div>
}

function TrendComparisonChart({ primary, secondary, primaryLabel, secondaryLabel, primaryColor, secondaryColor, formatter }: { primary: OperatingReport['trends']['leads']; secondary: OperatingReport['trends']['leads']; primaryLabel: string; secondaryLabel: string; primaryColor: string; secondaryColor: string; formatter: (value: number) => string }) {
  const max = Math.max(...primary.map((point) => point.value), ...secondary.map((point) => point.value), 1)
  const points = (series: OperatingReport['trends']['leads']) => series.map((point, index) => `${24 + (index / Math.max(series.length - 1, 1)) * 552},${150 - (point.value / max) * 120}`).join(' ')
  return <div><div className="mb-2 flex items-center gap-4 text-[10px] font-bold"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: primaryColor }} />{primaryLabel}</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: secondaryColor }} />{secondaryLabel}</span></div><svg role="img" aria-label={`${primaryLabel} and ${secondaryLabel} recorded trend`} viewBox="0 0 600 172" className="h-44 w-full"><line x1="24" x2="576" y1="150" y2="150" stroke="var(--crm-border)" /><line x1="24" x2="576" y1="90" y2="90" stroke="var(--crm-border)" strokeDasharray="4 5" /><line x1="24" x2="576" y1="30" y2="30" stroke="var(--crm-border)" strokeDasharray="4 5" /><polyline points={points(primary)} fill="none" stroke={primaryColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><polyline points={points(secondary)} fill="none" stroke={secondaryColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg><div className="flex items-center justify-between text-[9px] text-[var(--crm-text-muted)]"><span>{primary[0]?.label}</span><span>{primary.at(-1)?.label}</span><strong>{primaryLabel}: {formatter(primary.reduce((sum, point) => sum + point.value, 0))}</strong></div></div>
}

function DataRow({ label, value }: { label: string; value: string | number }) {
  return <div className="flex items-center justify-between gap-3 py-2 text-[10px]"><span className="font-semibold text-[var(--crm-text-muted)]">{label}</span><strong className="text-right text-[var(--crm-ink)]">{value}</strong></div>
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.replaceAll('_', ' ')
  return <span className="inline-flex rounded-full bg-[var(--crm-info-soft)] px-2 py-1 text-[9px] font-black capitalize text-[var(--crm-info)]">{normalized}</span>
}

function PanelHeading({ eyebrow, title, href, action = 'Open full report', tone = 'red' }: { eyebrow: string; title: string; href: string; action?: string; tone?: keyof typeof TONES }) {
  return <div className="flex items-center justify-between gap-3 border-b border-[var(--crm-border)] px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: TONES[tone].line }}>{eyebrow}</p><h2 className="mt-1 text-base font-black">{title}</h2></div><Link href={href} className="inline-flex items-center gap-1 text-xs font-black text-[var(--crm-info)] hover:underline">{action}<Icon name="arrow_forward" className="text-[16px]" /></Link></div>
}

function SourceRows({ rows, compact = false, expanded = false }: { rows: OperatingReport['marketing']['sources']; compact?: boolean; expanded?: boolean }) {
  if (rows.length === 0) return <EmptyState icon="campaign" title="No lead-source records" detail="No CRM leads were created in the selected period." />
  return <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Source</th><th className="px-3 py-3 text-right">Leads</th><th className="px-3 py-3 text-right">Opportunities</th>{compact ? null : <th className="px-3 py-3 text-right">Contracts</th>}{expanded ? <><th className="px-3 py-3 text-right">Opportunity rate</th><th className="px-5 py-3 text-right">Revenue</th></> : null}</tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{rows.map((row) => <tr key={row.source} className="hover:bg-[var(--crm-surface-subtle)]"><td className="px-5 py-3 font-bold">{formatLeadSource(row.source)}</td><td className="px-3 py-3 text-right font-black">{row.leads}</td><td className="px-3 py-3 text-right">{row.qualified}</td>{compact ? null : <td className="px-3 py-3 text-right">{row.contracts}</td>}{expanded ? <><td className="px-3 py-3 text-right">{nullablePercent(row.qualificationRate)}</td><td className="px-5 py-3 text-right font-black text-[#07883f]">{money(row.revenue)}</td></> : null}</tr>)}</tbody></table></div>
}

function RecentClosings({ report, embedded = false }: { report: OperatingReport; embedded?: boolean }) {
  if (!report.availability.dispositions) return <SourceUnavailable title="Closing data unavailable" />
  const content = <div className="overflow-x-auto">{report.dispositions.recentClosings.length === 0 ? <EmptyState icon="task_alt" title="No recorded closings" detail="No disposition deal closed in this period." /> : <table className="w-full min-w-[660px] text-left text-[10px]"><thead className="text-[9px] uppercase tracking-[0.05em] text-[var(--crm-text-muted)]"><tr><th className="pb-2">Property</th><th className="pb-2">Buyer</th><th className="pb-2 text-right">Fee</th><th className="pb-2">Close date</th><th className="pb-2 text-right">Debrief</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.dispositions.recentClosings.map((row) => <tr key={row.id}><td className="py-2 pr-3"><Link href={`/leads/${row.leadId}`} className="font-black hover:underline">{row.property}</Link>{row.city ? <span className="block text-[9px] text-[var(--crm-text-muted)]">{row.city}</span> : null}</td><td className="py-2 pr-3">{row.buyer}</td><td className="py-2 text-right font-black">{money(row.assignmentFee)}</td><td className="py-2">{shortDate(row.closeDate)}</td><td className="py-2 text-right"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${row.debriefComplete ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'}`}>{row.debriefComplete ? 'Complete' : 'Due'}</span></td></tr>)}</tbody></table>}</div>
  return embedded ? content : <section className="crm-panel overflow-hidden rounded-2xl"><PanelHeading eyebrow="Recent closed assignments" title="Closeout and debrief status" href="/dispo/pipeline" />{content}</section>
}

function CoverageNotice({ report }: { report: OperatingReport }) {
  const unavailable = Object.entries(report.availability).filter(([, available]) => !available).map(([source]) => source)
  if (unavailable.length === 0) return null
  return <div role="status" className="flex items-start gap-3 rounded-xl border border-[var(--crm-action-border)] bg-[var(--crm-action-soft)] px-4 py-3 text-xs font-semibold text-[var(--crm-action)]"><Icon name="data_alert" className="mt-0.5 text-[18px]" /><span>Partial data: {unavailable.join(', ')} {unavailable.length === 1 ? 'is' : 'are'} unavailable. Affected panels are intentionally not backfilled with sample values.</span></div>
}

function EmptyState({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return <div className="flex min-h-32 flex-col items-center justify-center px-5 py-7 text-center"><Icon name={icon} className="text-3xl text-[var(--crm-text-muted)]" /><strong className="mt-2 text-sm">{title}</strong><span className="mt-1 text-xs text-[var(--crm-text-muted)]">{detail}</span></div>
}

function SourceUnavailable({ title }: { title: string }) {
  return <section className="crm-panel rounded-2xl"><EmptyState icon="cloud_off" title={title} detail="This panel is not replaced with a sample or zero value." /></section>
}

function ReportSkeleton({ copy }: { copy: (typeof VIEW_COPY)[OperatingReportView] }) {
  return <main aria-label="Loading operating report" className="mx-auto max-w-[1600px] space-y-5 px-5 py-6"><header><p className="crm-eyebrow">{copy.eyebrow}</p><h1 className="mt-1 text-[25px] font-black tracking-[-0.035em] text-[var(--crm-ink)]">{copy.title}</h1><p className="mt-0.5 max-w-4xl text-xs font-medium text-[var(--crm-text-muted)]">{copy.description}</p></header><div className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-7">{Array.from({ length: 7 }, (_, index) => <div key={index} className="h-40 rounded-2xl bg-[var(--crm-surface-subtle)]" />)}</div><div className="h-80 animate-pulse rounded-2xl bg-[var(--crm-surface-subtle)]" /></main>
}

function ReportError({ onRetry }: { onRetry: () => void }) {
  return <main className="mx-auto max-w-[900px] px-5 py-12"><div className="crm-panel rounded-2xl p-10 text-center"><Icon name="cloud_off" className="text-4xl text-[var(--crm-brand)]" /><h1 className="mt-3 text-xl font-black">Operating data is temporarily unavailable</h1><p className="mt-2 text-sm text-[var(--crm-text-muted)]">The dashboard will not substitute sample data for the missing CRM response.</p><button type="button" onClick={onRetry} className="crm-primary-button mt-5 rounded-lg px-4 py-2.5 text-sm font-black">Try again</button></div></main>
}

function ReportPanelSkeleton() {
  return <div aria-label="Loading report data" className="space-y-3"><div className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-40 rounded-2xl bg-[var(--crm-surface-subtle)]" />)}</div><div className="h-80 animate-pulse rounded-2xl bg-[var(--crm-surface-subtle)]" /></div>
}

function ReportErrorPanel({ onRetry }: { onRetry: () => void }) {
  return <section className="crm-panel rounded-2xl p-10 text-center"><Icon name="cloud_off" className="text-4xl text-[var(--crm-brand)]" /><h2 className="mt-3 text-xl font-black">Operating data is temporarily unavailable</h2><p className="mt-2 text-sm text-[var(--crm-text-muted)]">Dashboard navigation remains available while the CRM response recovers. No sample data is substituted.</p><button type="button" onClick={onRetry} className="crm-primary-button mt-5 rounded-lg px-4 py-2.5 text-sm font-black">Try again</button></section>
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
function shortDate(value: string | null) { return value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded' }
function formatTimestamp(value: string) { return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
function available(condition: boolean, value: string | number) { return condition ? value : 'Unavailable' }
function compactNumber(value: number) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value) }
function seriesMomentum(series: OperatingReport['trends']['leads']): number | null {
  if (series.length < 2) return null
  const middle = Math.floor(series.length / 2)
  const previous = series.slice(0, middle).reduce((sum, point) => sum + point.value, 0)
  const current = series.slice(middle).reduce((sum, point) => sum + point.value, 0)
  if (previous === 0) return current > 0 ? 100 : null
  return Math.round(((current - previous) / previous) * 100)
}
function scaledGoal(goal: number | null, report: OperatingReport, cadence: 'daily' | 'weekly' | 'monthly'): number | null {
  if (goal == null || report.period.since == null) return goal
  const start = new Date(report.period.since).getTime()
  const end = new Date(report.period.until).getTime()
  const days = Math.max(1, (end - start) / 86_400_000)
  if (cadence === 'daily') return Math.round(goal * days * (5 / 7))
  if (cadence === 'weekly') return Math.round(goal * (days / 7))
  return Math.round(goal * (days / 30))
}
