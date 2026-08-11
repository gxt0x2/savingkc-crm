'use client'

import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { ReportDateRangeControl, type OperatingCustomRange } from '@/components/reports/report-date-range-control'
import { formatLeadSource } from '@/lib/contact-display'
import type { OperatingReport, OperatingReportPeriod } from '@/lib/operating-report'

type Tone = 'green' | 'violet' | 'blue' | 'coral' | 'amber' | 'teal' | 'red'

const TONES: Record<Tone, { color: string; icon: string }> = {
  green: { color: '#0b9348', icon: 'bg-[#e2f6e9] text-[#0b9348]' },
  violet: { color: '#6d28d9', icon: 'bg-[#eee5ff] text-[#6d28d9]' },
  blue: { color: '#1769e0', icon: 'bg-[#e2edff] text-[#1769e0]' },
  coral: { color: '#f05a28', icon: 'bg-[#ffebe4] text-[#f05a28]' },
  amber: { color: '#e3a008', icon: 'bg-[#fff1c8] text-[#bf7d00]' },
  teal: { color: '#078b87', icon: 'bg-[#dcf5f3] text-[#078b87]' },
  red: { color: '#d62937', icon: 'bg-[#ffe5e8] text-[#d62937]' },
}

export function ExecutiveDashboard({
  report,
  period,
  customRange,
  onPeriodChange,
  onCustomRangeChange,
  isFetching,
}: {
  report: OperatingReport
  period: OperatingReportPeriod
  customRange: OperatingCustomRange
  onPeriodChange: (period: OperatingReportPeriod) => void
  onCustomRangeChange: (range: OperatingCustomRange) => void
  isFetching: boolean
}) {
  const cards = [
    { icon: 'payments', label: 'Revenue (period)', value: report.availability.finance ? money(report.core.revenue) : 'Unavailable', numericValue: report.availability.finance ? report.core.revenue : null, detail: `${report.finance.revenueTransactions} recorded transaction${report.finance.revenueTransactions === 1 ? '' : 's'}`, tone: 'green' as const, href: '/reports/finance', series: report.trends.revenue, goal: scaledGoal(report.goals.monthlyRevenue, report, 'monthly') },
    { icon: 'filter_alt', label: 'Pipeline est. revenue', value: report.core.pipelineOfferValue == null ? 'Not recorded' : money(report.core.pipelineOfferValue), numericValue: report.core.pipelineOfferValue, detail: 'Recorded offers on active leads', tone: 'violet' as const, href: '/reports/acquisitions', series: null, goal: null },
    { icon: 'check_circle', label: 'Closings (period)', value: report.dispositions.closedDeals, numericValue: report.dispositions.closedDeals, detail: 'Recorded closed deals', tone: 'blue' as const, href: '/reports/dispositions', series: report.trends.closings, goal: scaledGoal(report.goals.monthlyClosings, report, 'monthly') },
    { icon: 'person_add', label: 'Assigned (period)', value: report.core.assigned, numericValue: report.core.assigned, detail: `${percent(report.core.assigned, report.core.leads)} of period leads`, tone: 'coral' as const, href: '/contacts?list=all', series: report.trends.assigned, goal: null },
    { icon: 'description', label: 'Under contract', value: report.core.underContract, numericValue: report.core.underContract, detail: `${percent(report.core.underContract, report.acquisitions.offers)} of offers`, tone: 'amber' as const, href: '/contacts?min_stage=under_contract', series: report.trends.underContract, goal: null },
    { icon: 'request_quote', label: 'Offers made', value: report.acquisitions.offers, numericValue: report.acquisitions.offers, detail: `${percent(report.acquisitions.offers, report.core.qualified)} of qualified`, tone: 'violet' as const, href: '/contacts?min_stage=offer_made', series: report.trends.offers, goal: null },
    { icon: 'verified', label: 'Qualified (period)', value: report.core.qualified, numericValue: report.core.qualified, detail: `${percent(report.core.qualified, report.core.leads)} of period leads`, tone: 'blue' as const, href: '/contacts?min_stage=qualified', series: report.trends.qualified, goal: scaledGoal(report.goals.weeklyQualified, report, 'weekly') },
    { icon: 'group', label: 'Leads (period)', value: report.core.leads, numericValue: report.core.leads, detail: 'New seller records', tone: 'teal' as const, href: '/contacts?list=new', series: report.trends.leads, goal: null },
  ]

  return (
    <main className="min-h-full w-full bg-[radial-gradient(circle_at_12%_0%,rgba(23,105,224,.035),transparent_25%),radial-gradient(circle_at_92%_2%,rgba(109,40,217,.035),transparent_27%)] px-3 pb-5 pt-1.5 text-[var(--crm-ink)] sm:px-4">
      <div className="mx-auto w-full max-w-[1780px] space-y-2.5">
        <header className="flex min-h-14 flex-col gap-2 px-0.5 py-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[22px] font-extrabold leading-7 tracking-[-0.035em]">CEO Operating System</h1>
            <p className="text-[11px] font-medium leading-4 text-[var(--crm-text-muted)]">Real-time overview of the entire business</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ReportDateRangeControl period={period} customRange={customRange} onPeriodChange={onPeriodChange} onCustomRangeChange={onCustomRangeChange} />
            <Link href="/reports/andon" className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-3 text-[10px] font-bold text-[var(--crm-danger)] shadow-[var(--crm-shadow-sm)] hover:border-[var(--crm-danger)]">
              <Icon name="warning_amber" className="text-[17px]" /> Andon system
            </Link>
            <Link href="/ari" className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 text-[10px] font-bold shadow-[var(--crm-shadow-sm)] hover:border-[var(--crm-violet)]">
              <Icon name="auto_awesome" className="text-[17px] text-[var(--crm-violet)]" /> Ask AI Assistant
            </Link>
          </div>
        </header>

        {isFetching ? <div role="status" className="sr-only">Refreshing dashboard data</div> : null}

        <section aria-label="Company operating metrics" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:h-[180px] 2xl:grid-cols-8">
          {cards.map((card) => <CeoMetricCard key={card.label} {...card} />)}
        </section>

        <section aria-label="Department operating flow" className="grid auto-rows-fr gap-2.5 xl:grid-cols-2 2xl:grid-cols-4">
          <MarketingPerformance report={report} />
          <AcquisitionsPerformance report={report} />
          <DispositionsPerformance report={report} />
          <RevenuePerformance report={report} />
        </section>

        <section className="grid gap-2.5 xl:grid-cols-2 2xl:h-[224px] 2xl:grid-cols-[.96fr_.70fr_1.42fr]">
          <ActiveBottlenecks report={report} />
          <AiInsights report={report} />
          <AiAssistant report={report} />
        </section>
      </div>
    </main>
  )
}

type MetricCardProps = {
  icon: string
  label: string
  value: string | number
  numericValue: number | null
  detail: string
  tone: Tone
  href: string
  series: OperatingReport['trends']['leads'] | null
  goal: number | null
}

function CeoMetricCard({ icon, label, value, numericValue, detail, tone, href, series, goal }: MetricCardProps) {
  const palette = TONES[tone]
  const movement = series ? seriesMomentum(series) : null
  const progress = goal != null && goal > 0 && numericValue != null ? Math.min(100, Math.round((numericValue / goal) * 100)) : null
  const periodLabel = label.endsWith(' (period)')
  const primaryLabel = periodLabel ? label.slice(0, -9) : label
  return (
    <Link href={href} aria-label={`${label}: ${value}. ${detail}`} className="group flex min-h-[166px] flex-col rounded-lg border p-3 shadow-[0_1px_3px_rgba(16,24,40,.05)] transition-shadow hover:shadow-[0_4px_12px_rgba(16,24,40,.08)]" style={{ background: `color-mix(in srgb, ${palette.color} 7%, var(--crm-surface))`, borderColor: `color-mix(in srgb, ${palette.color} 18%, var(--crm-border))` }}>
      <div className="flex items-center gap-2">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${palette.icon}`}><Icon name={icon} className="text-[16px]" /></span>
        <span className="min-w-0 flex-1 text-[10px] font-bold leading-3.5 text-[var(--crm-ink)]"><span>{primaryLabel}</span>{periodLabel ? <span className="font-medium text-[var(--crm-text-muted)]"> (period)</span> : null}</span>
      </div>
      <strong className={`mt-2 block tracking-[-0.035em] ${typeof value === 'string' && value.length > 12 ? 'text-[18px]' : 'text-[25px]'} font-extrabold leading-7`}>{value}</strong>
      <span className="mt-0.5 block min-h-4 text-[9px] font-medium leading-3 text-[var(--crm-text-muted)]">{detail}</span>
      <div className="mt-auto">
        {series ? <MiniSparkline series={series} color={palette.color} label={`${label} recorded trend`} /> : <div className="h-6" />}
        <div className="flex items-center justify-between gap-1 text-[9px] font-semibold">
          <span className={movement == null ? 'text-[var(--crm-text-dim)]' : movement >= 0 ? 'text-[var(--crm-success)]' : 'text-[var(--crm-danger)]'}>{movement == null ? 'No prior activity' : `${movement >= 0 ? '↑' : '↓'} ${Math.abs(movement)}% vs prior period`}</span>
        </div>
        <div className="mt-1.5 text-[9px] font-semibold text-[var(--crm-text-muted)]">Goal: {goal == null ? 'Not configured' : compactNumber(goal)}</div>
        <div className="mt-1 h-1 rounded-full bg-[color-mix(in_srgb,var(--crm-border)_65%,transparent)]"><span className="block h-full rounded-full" style={{ width: `${progress ?? 0}%`, background: palette.color }} /></div>
      </div>
    </Link>
  )
}

function DashboardPanel({ title, period, tone, href, children }: { title: string; period?: string; tone: Tone; href: string; children: React.ReactNode }) {
  const palette = TONES[tone]
  return (
    <section className="flex min-h-[260px] flex-col overflow-hidden rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-[0_1px_3px_rgba(16,24,40,.05)]">
      <header className="flex h-8 shrink-0 items-center justify-between px-3" style={{ background: `color-mix(in srgb, ${palette.color} 7%, var(--crm-surface))` }}>
        <div className="flex items-baseline gap-1"><h2 className="text-[10px] font-extrabold uppercase tracking-[0.035em]" style={{ color: palette.color }}>{title}</h2>{period ? <span className="text-[9px] font-medium text-[var(--crm-text-muted)]">({period})</span> : null}</div>
        <Link href={href} aria-label={`Open ${title}`} className="text-[9px] font-bold text-[var(--crm-info)] hover:underline">View dashboard <Icon name="arrow_forward" className="text-[11px]" /></Link>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

function AcquisitionsPerformance({ report }: { report: OperatingReport }) {
  const attended = report.acquisitions.appointmentShowRate == null ? null : Math.round(report.acquisitions.appointmentsRecorded * report.acquisitions.appointmentShowRate / 100)
  const goalAppointments = scaledGoal(report.goals.weeklyAppointments, report, 'weekly')
  const goalCalls = scaledGoal(report.goals.dailyCalls, report, 'daily')
  const metrics = [
    { label: 'Speed to lead', value: minutes(report.acquisitions.averageSpeedToLeadMinutes), numeric: report.acquisitions.averageSpeedToLeadMinutes ?? 0, goal: 2, tone: 'blue' as const, icon: 'speed' },
    { label: 'Meaningful conversations', value: report.communications.connectedCalls, numeric: report.communications.connectedCalls, goal: goalCalls, tone: 'green' as const, icon: 'forum' },
    { label: 'Appointments attended', value: attended == null ? 'Not recorded' : attended, numeric: attended ?? 0, goal: goalAppointments, tone: 'blue' as const, icon: 'calendar_month' },
    { label: 'Offers presented', value: report.acquisitions.offers, numeric: report.acquisitions.offers, goal: null, tone: 'violet' as const, icon: 'request_quote' },
    { label: 'Under contract', value: report.core.underContract, numeric: report.core.underContract, goal: scaledGoal(report.goals.monthlyClosings, report, 'monthly'), tone: 'teal' as const, icon: 'description' },
  ]
  return <DashboardPanel title="Acquisitions" period="Selected period" tone="blue" href="/reports/acquisitions"><div className="grid h-full grid-cols-2 divide-x divide-y divide-[var(--crm-border)] sm:grid-cols-5 sm:divide-y-0">{metrics.map((metric) => <GaugeMetric key={metric.label} {...metric} />)}</div></DashboardPanel>
}

function GaugeMetric({ label, value, numeric, goal, tone, icon }: { label: string; value: string | number; numeric: number; goal: number | null; tone: Tone; icon: string }) {
  const palette = TONES[tone]
  const progress = goal != null && goal > 0 ? Math.min(100, Math.round((numeric / goal) * 100)) : 0
  return (
    <div className="flex min-w-0 flex-col items-center justify-center px-2 py-2 text-center">
      <span className="min-h-7 text-[9px] font-bold leading-3 text-[var(--crm-ink)]">{label}</span>
      <svg role="img" aria-label={`${label}: ${value}`} viewBox="0 0 72 42" className="mt-1 h-10 w-[72px]">
        <path d="M8 36 A28 28 0 0 1 64 36" fill="none" stroke="var(--crm-border)" strokeWidth="7" strokeLinecap="round" pathLength="100" />
        <path d="M8 36 A28 28 0 0 1 64 36" fill="none" stroke={palette.color} strokeWidth="7" strokeLinecap="round" pathLength="100" strokeDasharray={`${progress} 100`} />
        <line x1="36" y1="36" x2={36 + 22 * Math.cos(Math.PI - (progress / 100) * Math.PI)} y2={36 - 22 * Math.sin((progress / 100) * Math.PI)} stroke="var(--crm-ink)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="36" cy="36" r="3" fill="var(--crm-ink)" />
        <IconSvg name={icon} color={palette.color} />
      </svg>
      <strong className={`mt-0.5 font-extrabold tracking-[-0.03em] ${typeof value === 'string' && value.length > 10 ? 'text-[11px]' : 'text-[19px]'}`}>{value}</strong>
      <span className="mt-1 text-[9px] font-semibold text-[var(--crm-success)]">Goal: {goal == null ? 'Not configured' : compactNumber(goal)}</span>
    </div>
  )
}

function IconSvg({ name, color }: { name: string; color: string }) {
  const glyphs: Record<string, string> = { speed: '↗', forum: '●', calendar_month: '□', description: '▤' }
  return <text x="36" y="29" textAnchor="middle" fontSize="10" fontWeight="700" fill={color}>{glyphs[name] ?? '•'}</text>
}

function DispositionsPerformance({ report }: { report: OperatingReport }) {
  const metrics = [
    ['New buyers', report.dispositions.newBuyers],
    ['Properties marketed', report.dispositions.propertiesMarketed],
    ['Offers received', report.dispositions.offers],
    ['Properties assigned', report.dispositions.assignedDeals],
    ['Assignments closed', report.dispositions.closedDeals],
    ['Revenue closed', money(report.dispositions.assignmentRevenue)],
  ]
  return <DashboardPanel title="Dispositions" period="Selected period" tone="red" href="/reports/dispositions"><div className="grid h-full grid-cols-3 grid-rows-2 divide-x divide-y divide-[var(--crm-border)]">{metrics.map(([label, value]) => <div key={label} className="flex min-w-0 flex-col items-center justify-center px-1.5 py-2 text-center"><span className="min-h-6 text-[9px] font-bold leading-3">{label}</span><strong className={`mt-1 font-extrabold tracking-[-0.035em] ${String(value).length > 11 ? 'text-[11px]' : 'text-[18px]'}`}>{value}</strong><span className="mt-1 text-[9px] font-semibold text-[var(--crm-success)]">Recorded CRM</span></div>)}</div></DashboardPanel>
}

function MarketingPerformance({ report }: { report: OperatingReport }) {
  const sources = report.marketing.sources.slice(0, 5)
  return (
    <DashboardPanel title="Marketing" period="Selected period" tone="violet" href="/reports/marketing">
      <div className="grid h-full min-h-0 grid-rows-[78px_1fr] divide-y divide-[var(--crm-border)]">
        <div className="grid grid-cols-2 divide-x divide-[var(--crm-border)]">
          <div className="flex flex-col items-center justify-center"><strong className="text-2xl font-black">{report.core.leads}</strong><span className="text-[9px] font-bold text-[var(--crm-text-muted)]">All leads</span></div>
          <div className="flex flex-col items-center justify-center"><strong className="text-2xl font-black text-[var(--crm-info)]">{report.core.qualified}</strong><span className="text-[9px] font-bold text-[var(--crm-text-muted)]">Qualified leads</span></div>
        </div>
        <div className="min-w-0 px-3 py-2"><div className="grid grid-cols-[1fr_44px_52px] gap-1 border-b border-[var(--crm-border)] pb-1 text-[8px] font-bold uppercase text-[var(--crm-text-muted)]"><span>Top lead source</span><span className="text-right">Leads</span><span className="text-right">Qualified</span></div>{sources.length > 0 ? sources.map((source) => <Link href="/reports/marketing" key={source.source} className="grid grid-cols-[1fr_44px_52px] gap-1 border-b border-[var(--crm-border)] py-1.5 text-[9px] hover:bg-[var(--crm-surface-subtle)]"><strong className="truncate">{formatLeadSource(source.source)}</strong><span className="text-right">{source.leads}</span><span className="text-right font-bold text-[var(--crm-info)]">{source.qualified}</span></Link>) : <div className="grid h-full place-items-center text-[10px] text-[var(--crm-text-muted)]">No recorded lead sources</div>}
        </div>
      </div>
    </DashboardPanel>
  )
}

function RevenuePerformance({ report }: { report: OperatingReport }) {
  const stages = report.finance.pipelineRevenueByStage.slice(0, 5)
  const maximum = Math.max(...stages.map(([, value]) => value), 1)
  return <DashboardPanel title="Revenue" period="Selected period" tone="green" href="/reports/finance"><div className="grid h-full grid-rows-[78px_1fr] divide-y divide-[var(--crm-border)]"><div className="grid grid-cols-2 divide-x divide-[var(--crm-border)]"><div className="flex flex-col items-center justify-center"><strong className="text-[20px] font-black">{money(report.finance.grossRevenue)}</strong><span className="text-[9px] font-bold text-[var(--crm-text-muted)]">Closed revenue</span></div><div className="flex flex-col items-center justify-center"><strong className={`font-black ${report.core.pipelineOfferValue == null ? 'text-sm' : 'text-[20px]'}`}>{report.core.pipelineOfferValue == null ? 'Not recorded' : money(report.core.pipelineOfferValue)}</strong><span className="text-[9px] font-bold text-[var(--crm-text-muted)]">Pipeline revenue</span></div></div><div className="px-3 py-2"><div className="mb-1 text-[8px] font-black uppercase text-[var(--crm-text-muted)]">Pipeline revenue by stage</div>{stages.length > 0 ? <div className="space-y-1.5">{stages.map(([stage, value]) => <div key={stage} className="grid grid-cols-[76px_1fr_54px] items-center gap-2 text-[8px]"><span className="truncate font-bold capitalize">{stage.replaceAll('_', ' ')}</span><span className="h-1.5 overflow-hidden rounded-full bg-[var(--crm-surface-subtle)]"><span className="block h-full rounded-full bg-[var(--crm-success)]" style={{ width: `${Math.round(value / maximum * 100)}%` }} /></span><strong className="text-right">{money(value)}</strong></div>)}</div> : <div className="grid h-20 place-items-center text-[10px] font-semibold text-[var(--crm-text-muted)]">No recorded pipeline offers</div>}</div></div></DashboardPanel>
}

function ActiveBottlenecks({ report }: { report: OperatingReport }) {
  return <DashboardPanel title="Active bottlenecks" tone="amber" href="/tasks"><div className="px-3 py-1"><div className="grid grid-cols-[1fr_58px_44px_44px] gap-1 border-b border-[var(--crm-border)] py-1 text-[8px] font-bold uppercase text-[var(--crm-text-muted)]"><span>Issue</span><span>Dept.</span><span className="text-right">Impact</span><span className="text-right">Status</span></div>{report.bottlenecks.slice(0, 5).map((row) => <Link key={row.key} href={row.href} className="grid grid-cols-[1fr_58px_44px_44px] items-center gap-1 border-b border-[var(--crm-border)] py-2 text-[9px] hover:bg-[var(--crm-surface-subtle)]"><strong className="truncate">{row.label}</strong><span className="truncate text-[var(--crm-text-muted)]">{row.department}</span><span className="text-right font-bold">{row.count}</span><span className={`rounded-full px-1 py-0.5 text-center text-[8px] font-bold ${row.severity === 'high' ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : row.severity === 'medium' ? 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' : 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'}`}>{row.severity === 'clear' ? 'Clear' : row.severity}</span></Link>)}</div></DashboardPanel>
}

function AiInsights({ report }: { report: OperatingReport }) {
  return <DashboardPanel title="AI insights" tone="blue" href="/ari"><div className="space-y-2 px-3 py-2">{report.insights.slice(0, 4).map((insight) => { const attention = /need|below|outstanding|unassigned|overdue/i.test(insight); return <div key={insight} className="flex gap-2 text-[9px] font-medium leading-3.5"><Icon name={attention ? 'warning_amber' : 'check_circle'} className={`mt-0.5 text-[13px] ${attention ? 'text-[var(--crm-warning)]' : 'text-[var(--crm-success)]'}`} /><span>{insight}</span></div>})}</div></DashboardPanel>
}

function AiAssistant({ report }: { report: OperatingReport }) {
  const prompts = ['How is my pipeline performing?', 'Why are contracts down?', 'Show my revenue forecast', 'What bottleneck needs attention?']
  return <DashboardPanel title="AI assistant" tone="violet" href="/ari"><div className="grid h-full grid-cols-[1fr_112px] gap-2 px-3 py-2"><div className="min-w-0"><p className="text-[10px] font-medium">Hi Ernest, how can I help you today?</p><div className="mt-2 grid grid-cols-2 gap-1">{prompts.map((prompt) => <Link key={prompt} href={`/ari?prompt=${encodeURIComponent(prompt)}`} className="truncate rounded-full border border-[var(--crm-border)] bg-[var(--crm-surface)] px-2 py-1.5 text-[8px] font-semibold text-[var(--crm-text-muted)] hover:border-[var(--crm-violet)] hover:text-[var(--crm-violet)]">{prompt}</Link>)}</div><form action="/ari" className="mt-3 flex h-9 items-center rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-2"><input name="prompt" aria-label="Ask ARI a question" placeholder="Type your question..." className="min-w-0 flex-1 bg-transparent text-[9px] outline-none" /><button type="submit" aria-label="Send question to ARI" className="grid h-6 w-6 place-items-center rounded-full bg-[var(--crm-info-soft)] text-[var(--crm-info)]"><Icon name="arrow_forward" className="text-[13px]" /></button></form><p className="mt-2 text-[8px] text-[var(--crm-text-muted)]">Live context: {report.core.leads} leads · {report.core.needsReply} replies need attention</p></div><AriRobot /></div></DashboardPanel>
}

function AriRobot() {
  return <svg aria-hidden="true" viewBox="0 0 120 150" className="h-full max-h-[160px] w-full self-end"><defs><linearGradient id="ariBody" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#eff6ff" /><stop offset="1" stopColor="#c9dcff" /></linearGradient></defs><ellipse cx="60" cy="137" rx="37" ry="7" fill="#dbe6f7" /><path d="M31 81c0-18 13-31 29-31s29 13 29 31v36c0 12-10 21-22 21H53c-12 0-22-9-22-21z" fill="url(#ariBody)" stroke="#78a7ff" strokeWidth="2" /><rect x="25" y="25" width="70" height="52" rx="25" fill="#f7fbff" stroke="#78a7ff" strokeWidth="2" /><rect x="33" y="34" width="54" height="34" rx="16" fill="#102358" /><circle cx="50" cy="51" r="5" fill="#42e8ff" /><circle cx="70" cy="51" r="5" fill="#42e8ff" /><path d="M51 61c6 4 12 4 18 0" fill="none" stroke="#42e8ff" strokeWidth="2" strokeLinecap="round" /><path d="M60 25V15" stroke="#78a7ff" strokeWidth="3" strokeLinecap="round" /><circle cx="60" cy="12" r="4" fill="#7c3aed" /><path d="M31 91 17 106M89 91l14 15" stroke="#78a7ff" strokeWidth="7" strokeLinecap="round" /><circle cx="15" cy="109" r="6" fill="#eaf2ff" stroke="#78a7ff" strokeWidth="2" /><circle cx="105" cy="109" r="6" fill="#eaf2ff" stroke="#78a7ff" strokeWidth="2" /><rect x="46" y="83" width="28" height="22" rx="7" fill="#ffffff" stroke="#78a7ff" /><path d="m55 94 4 4 7-9" fill="none" stroke="#6d28d9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d="M47 137v8M73 137v8" stroke="#78a7ff" strokeWidth="8" strokeLinecap="round" /></svg>
}

function MiniSparkline({ series, color, label }: { series: OperatingReport['trends']['leads']; color: string; label: string }) {
  const values = series.map((point) => point.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 130},${25 - ((value - min) / span) * 21}`).join(' ')
  return <svg role="img" aria-label={label} viewBox="0 0 130 28" className="h-6 w-full"><polyline points={points} fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>
}

function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) }
function minutes(value: number | null) { return value == null ? 'Not recorded' : value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m` }
function percent(numerator: number, denominator: number) { return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : '—' }
function compactNumber(value: number) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value) }
function seriesMomentum(series: OperatingReport['trends']['leads']): number | null { const middle = Math.floor(series.length / 2); const previous = series.slice(0, middle).reduce((sum, point) => sum + point.value, 0); const current = series.slice(middle).reduce((sum, point) => sum + point.value, 0); return previous === 0 ? current > 0 ? 100 : null : Math.round(((current - previous) / previous) * 100) }
function scaledGoal(goal: number | null, report: OperatingReport, cadence: 'daily' | 'weekly' | 'monthly'): number | null { if (goal == null || report.period.since == null) return goal; const days = Math.max(1, (new Date(report.period.until).getTime() - new Date(report.period.since).getTime()) / 86_400_000); if (cadence === 'daily') return Math.round(goal * days * (5 / 7)); if (cadence === 'weekly') return Math.round(goal * (days / 7)); return Math.round(goal * (days / 30)) }
