import Link from 'next/link'

import { Icon } from '@/components/ui/icon'
import { formatLeadSource } from '@/lib/contact-display'
import type { OperatingReport } from '@/lib/operating-report'

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

const SOURCE_COLORS = ['#1769e0', '#6d28d9', '#0b9348', '#f05a28', '#e3a008', '#078b87', '#d62937']
const ACQUISITION_SOURCE_CHANNELS = [
  { key: 'google_general', label: 'Google - General' },
  { key: 'google_tax_delinquent', label: 'Google - Tax Delinquent' },
  { key: 'cold_calls', label: 'Cold Calls' },
  { key: 'sms_outreach', label: 'SMS Outreach' },
  { key: 'youtube', label: 'YouTube' },
] as const
type AcquisitionSourceChannel = (typeof ACQUISITION_SOURCE_CHANNELS)[number]['key']
type OperatingSourceRow = OperatingReport['marketing']['sources'][number]

export interface AcquisitionSourceRow {
  key: AcquisitionSourceChannel
  label: string
  leads: number
  qualified: number
  appointments: number
  contracts: number
  revenue: number
}

interface FunnelStageInput {
  label: string
  value: number
}

export interface FunnelStageGeometry extends FunnelStageInput {
  index: number
  ratio: number
  topY: number
  bottomY: number
  topLeft: number
  topRight: number
  bottomLeft: number
  bottomRight: number
}

const FUNNEL_CENTER_X = 300
const FUNNEL_MAX_WIDTH = 360
const FUNNEL_MIN_WIDTH = 20
const FUNNEL_TOP_Y = 12
const FUNNEL_STAGE_HEIGHT = 40

export function buildFunnelGeometry(stages: FunnelStageInput[]): FunnelStageGeometry[] {
  if (stages.length === 0) return []

  const denominator = Math.max(stages[0]?.value ?? 0, ...stages.map((stage) => stage.value), 1)
  let previousWidth = FUNNEL_MAX_WIDTH
  const boundaries = stages.map((stage, index) => {
    const ratio = Math.min(1, Math.max(0, stage.value / denominator))
    const proportionalWidth = Math.max(FUNNEL_MIN_WIDTH, FUNNEL_MAX_WIDTH * ratio)
    const width = index === 0 ? FUNNEL_MAX_WIDTH : Math.min(previousWidth, proportionalWidth)
    previousWidth = width
    return {
      width,
      left: FUNNEL_CENTER_X - width / 2,
      right: FUNNEL_CENTER_X + width / 2,
    }
  })

  return stages.map((stage, index) => {
    const top = boundaries[index]
    const bottom = boundaries[index + 1] ?? top
    const topY = FUNNEL_TOP_Y + index * FUNNEL_STAGE_HEIGHT
    return {
      ...stage,
      index,
      ratio: Math.min(1, Math.max(0, stage.value / denominator)),
      topY,
      bottomY: topY + FUNNEL_STAGE_HEIGHT,
      topLeft: top.left,
      topRight: top.right,
      bottomLeft: bottom.left,
      bottomRight: bottom.right,
    }
  })
}

const OPTIMIZED_RATES = {
  qualification: 40,
  appointment: 60,
  contract: 20,
  assignment: 80,
  close: 80,
} as const

interface ConversionRates {
  qualification: number
  appointment: number
  contract: number
  assignment: number
  close: number
}

export interface RevenueLiftModel {
  currentRates: ConversionRates
  optimizedRates: ConversionRates
  averageDealMargin: number | null
  currentClosings: number
  projectedClosings: number | null
  currentRevenue: number | null
  optimizedRevenue: number | null
  revenueLift: number | null
}

export function buildRevenueLiftModel(report: OperatingReport): RevenueLiftModel {
  const averageDealMargin = report.dispositions.averageAssignmentFee ?? report.finance.averageRevenuePerTransaction
  const currentRates = {
    qualification: rate(report.acquisitions.qualified, report.acquisitions.total),
    appointment: rate(report.acquisitions.appointments, report.acquisitions.qualified),
    contract: rate(report.acquisitions.contracts, report.acquisitions.appointments),
    assignment: rate(report.dispositions.assignedDeals, report.acquisitions.contracts),
    close: rate(report.dispositions.closedDeals, report.dispositions.assignedDeals),
  }
  const projectedClosings = report.acquisitions.total > 0
    ? report.acquisitions.total * Object.values(OPTIMIZED_RATES).reduce((product, value) => product * (value / 100), 1)
    : null
  const currentRevenue = averageDealMargin == null ? null : report.dispositions.closedDeals * averageDealMargin
  const optimizedRevenue = averageDealMargin == null || projectedClosings == null ? null : projectedClosings * averageDealMargin

  return {
    currentRates,
    optimizedRates: OPTIMIZED_RATES,
    averageDealMargin,
    currentClosings: report.dispositions.closedDeals,
    projectedClosings,
    currentRevenue,
    optimizedRevenue,
    revenueLift: optimizedRevenue == null || currentRevenue == null ? null : optimizedRevenue - currentRevenue,
  }
}

export function buildAcquisitionSourceRows(sourceRows: OperatingSourceRow[]): AcquisitionSourceRow[] {
  const rows = new Map<AcquisitionSourceChannel, AcquisitionSourceRow>(
    ACQUISITION_SOURCE_CHANNELS.map((channel) => [channel.key, {
      ...channel,
      leads: 0,
      qualified: 0,
      appointments: 0,
      contracts: 0,
      revenue: 0,
    }]),
  )

  for (const sourceRow of sourceRows) {
    const channel = acquisitionSourceChannel(sourceRow.source)
    if (!channel) continue
    const row = rows.get(channel)!
    row.leads += sourceRow.leads
    row.qualified += sourceRow.qualified
    row.appointments += sourceRow.appointments
    row.contracts += sourceRow.contracts
    row.revenue += sourceRow.revenue
  }

  return ACQUISITION_SOURCE_CHANNELS.map(({ key }) => rows.get(key)!)
}

export function AcquisitionsMetricsDashboard({ report }: { report: OperatingReport }) {
  const attended = report.acquisitions.appointmentShowRate == null
    ? null
    : Math.round(report.acquisitions.appointmentsRecorded * report.acquisitions.appointmentShowRate / 100)
  const cards = [
    { icon: 'group_add', label: 'New leads', value: report.acquisitions.total, detail: `${report.acquisitions.notLeads} marked not a lead`, tone: 'teal' as const, href: '/contacts?list=new', series: report.trends.leads, goal: null },
    { icon: 'verified', label: 'Qualified', value: report.acquisitions.qualified, detail: `${percent(report.acquisitions.qualified, report.acquisitions.total)} qualification rate`, tone: 'blue' as const, href: '/contacts?min_stage=qualified', series: report.trends.qualified, goal: scaledGoal(report.goals.weeklyQualified, report, 'weekly') },
    { icon: 'calendar_month', label: 'Appointments', value: report.acquisitions.appointmentsRecorded, detail: attended == null ? 'Attendance not recorded' : `${attended} recorded attended`, tone: 'violet' as const, href: '/calendar?department=acquisitions', series: report.trends.appointments, goal: scaledGoal(report.goals.weeklyAppointments, report, 'weekly') },
    { icon: 'description', label: 'Under contract', value: report.acquisitions.contracts, detail: `${percent(report.acquisitions.contracts, report.acquisitions.total)} lead-to-contract`, tone: 'amber' as const, href: '/contacts?min_stage=under_contract', series: report.trends.underContract, goal: null },
    { icon: 'speed', label: 'Speed to lead', value: formatMinutes(report.acquisitions.averageSpeedToLeadMinutes), detail: 'First recorded outbound action', tone: 'coral' as const, href: '/reports/call-sms', series: null, goal: 2 },
    { icon: 'forum', label: 'Connected calls', value: report.communications.connectedCalls, detail: `${nullablePercent(report.communications.callConnectionRate)} connection rate`, tone: 'green' as const, href: '/reports/call-sms', series: report.trends.calls, goal: scaledGoal(report.goals.dailyCalls, report, 'daily') },
    { icon: 'task_alt', label: 'Closed won', value: report.dispositions.closedDeals, detail: `${percent(report.dispositions.closedDeals, report.acquisitions.total)} of period leads`, tone: 'red' as const, href: '/reports/dispositions', series: report.trends.closings, goal: scaledGoal(report.goals.monthlyClosings, report, 'monthly') },
  ]

  return (
    <div className="space-y-2.5">
      <section aria-label="Acquisition operating metrics" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {cards.map((card) => <AcquisitionMetricCard key={card.label} {...card} />)}
      </section>

      <section className="grid gap-2.5 xl:grid-cols-[0.82fr_1.18fr]">
        <DashboardPanel title="Acquisitions performance" period="Selected period" tone="blue" href="/contacts">
          <PerformanceGauges report={report} attended={attended} />
        </DashboardPanel>
        <DashboardPanel title="Lead-source performance" period="CRM attributed" tone="violet" href="/reports/marketing">
          <LeadSourcePerformance report={report} />
        </DashboardPanel>
      </section>

      <section className="grid gap-2.5 xl:grid-cols-[0.88fr_1.12fr]">
        <DashboardPanel title="Qualification and status" period="Selected cohort" tone="coral" href="/contacts?list=not_leads">
          <QualificationStatus report={report} />
        </DashboardPanel>
        <DashboardPanel title="Acquisition activity" period="Selected period" tone="green" href="/reports/call-sms">
          <ActivityPerformance report={report} />
        </DashboardPanel>
      </section>

      <section className="grid gap-2.5 xl:grid-cols-[0.76fr_1.24fr]">
        <DashboardPanel title="Lead-to-close funnel" period="Stage conversion" tone="blue" href="/contacts">
          <AcquisitionFunnel report={report} />
        </DashboardPanel>
        <DashboardPanel title="Agent acquisition scorecard" period="Ownership plus communication" tone="teal" href="/reports/call-sms">
          <AgentScorecard report={report} />
        </DashboardPanel>
      </section>

      <section className="grid gap-2.5 xl:grid-cols-[0.72fr_1.28fr]">
        <DashboardPanel title="Cost and efficiency" period="Recorded acquisition expenses" tone="green" href="/reports/finance">
          <CostEfficiency report={report} />
        </DashboardPanel>
        <DashboardPanel title="Revenue lift model" period="Current CRM vs Left Main benchmark" tone="amber" href="/ari">
          <RevenueLift report={report} />
        </DashboardPanel>
      </section>

      <section className="grid gap-2.5 xl:grid-cols-[1.12fr_0.88fr]">
        <DashboardPanel title="Funnel process and stage metrics" tone="violet" href="/workflows">
          <ProcessMetrics />
        </DashboardPanel>
        <DashboardPanel title="Active acquisition constraints" tone="red" href="/tasks">
          <AcquisitionConstraints report={report} />
        </DashboardPanel>
      </section>
    </div>
  )
}

type MetricCardProps = {
  icon: string
  label: string
  value: string | number
  detail: string
  tone: Tone
  href: string
  series: OperatingReport['trends']['leads'] | null
  goal: number | null
}

function AcquisitionMetricCard({ icon, label, value, detail, tone, href, series, goal }: MetricCardProps) {
  const palette = TONES[tone]
  const numericValue = typeof value === 'number' ? value : null
  const progress = goal != null && goal > 0 && numericValue != null ? Math.min(100, Math.round((numericValue / goal) * 100)) : null
  const movement = series ? seriesMomentum(series) : null
  return (
    <Link href={href} className="group flex min-h-[164px] flex-col rounded-lg border p-3 shadow-[0_1px_3px_rgba(16,24,40,.05)] transition-all hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(16,24,40,.09)]" style={{ background: `color-mix(in srgb, ${palette.color} 7%, var(--crm-surface))`, borderColor: `color-mix(in srgb, ${palette.color} 18%, var(--crm-border))` }}>
      <div className="flex items-center gap-2"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${palette.icon}`}><Icon name={icon} className="text-[16px]" /></span><span className="min-w-0 flex-1 text-[10px] font-bold leading-3.5">{label}</span><Icon name="arrow_outward" className="text-[13px] opacity-0 group-hover:opacity-100" /></div>
      <strong className={`mt-2 block font-extrabold leading-7 tracking-[-0.035em] ${String(value).length > 12 ? 'text-[17px]' : 'text-[25px]'}`}>{value}</strong>
      <span className="mt-0.5 min-h-6 text-[9px] font-medium leading-3 text-[var(--crm-text-muted)]">{detail}</span>
      <div className="mt-auto">
        {series ? <MiniSparkline series={series} color={palette.color} label={`${label} recorded trend`} /> : <div className="h-7" />}
        <div className="flex items-center justify-between gap-1 text-[8px] font-semibold"><span className={movement == null ? 'text-[var(--crm-text-dim)]' : movement >= 0 ? 'text-[var(--crm-success)]' : 'text-[var(--crm-danger)]'}>{movement == null ? 'Live CRM snapshot' : `${movement >= 0 ? '↑' : '↓'} ${Math.abs(movement)}% vs prior half`}</span><span className="text-[var(--crm-text-muted)]">Goal {goal == null ? 'not set' : compactNumber(goal)}</span></div>
        <div className="mt-1.5 h-1 rounded-full bg-[color-mix(in_srgb,var(--crm-border)_65%,transparent)]"><span className="block h-full rounded-full" style={{ width: `${progress ?? 0}%`, background: palette.color }} /></div>
      </div>
    </Link>
  )
}

function DashboardPanel({ title, period, tone, href, children }: { title: string; period?: string; tone: Tone; href: string; children: React.ReactNode }) {
  const palette = TONES[tone]
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-[0_1px_3px_rgba(16,24,40,.05)]">
      <header className="flex min-h-9 shrink-0 items-center justify-between gap-2 px-3 py-1.5" style={{ background: `color-mix(in srgb, ${palette.color} 7%, var(--crm-surface))` }}>
        <div className="flex min-w-0 items-baseline gap-1"><h2 className="truncate text-[10px] font-extrabold uppercase tracking-[0.035em]" style={{ color: palette.color }}>{title}</h2>{period ? <span className="hidden text-[9px] font-medium text-[var(--crm-text-muted)] sm:inline">({period})</span> : null}</div>
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[9px] font-bold text-[var(--crm-info)] hover:underline">View detail <Icon name="arrow_forward" className="text-[11px]" /></Link>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

function PerformanceGauges({ report, attended }: { report: OperatingReport; attended: number | null }) {
  const rows = [
    { label: 'Speed to lead', value: formatMinutes(report.acquisitions.averageSpeedToLeadMinutes), progress: inverseProgress(report.acquisitions.averageSpeedToLeadMinutes, 2), tone: 'blue' as const },
    { label: 'Meaningful conversations', value: report.communications.connectedCalls, progress: report.communications.callConnectionRate ?? 0, tone: 'green' as const },
    { label: 'Appointments attended', value: attended ?? 'Not recorded', progress: report.acquisitions.appointmentShowRate ?? 0, tone: 'violet' as const },
    { label: 'Under contract', value: report.acquisitions.contracts, progress: rate(report.acquisitions.contracts, report.acquisitions.total), tone: 'teal' as const },
  ]
  return <div className="grid h-full grid-cols-2 divide-x divide-y divide-[var(--crm-border)] sm:grid-cols-4 sm:divide-y-0">{rows.map((row) => <Gauge key={row.label} {...row} />)}</div>
}

function Gauge({ label, value, progress, tone }: { label: string; value: string | number; progress: number; tone: Tone }) {
  const color = TONES[tone].color
  return <div className="flex min-h-[150px] flex-col items-center justify-center px-2 py-3 text-center"><span className="min-h-7 text-[9px] font-bold leading-3">{label}</span><svg role="img" aria-label={`${label}: ${value}`} viewBox="0 0 72 42" className="mt-1 h-11 w-[76px]"><path d="M8 36 A28 28 0 0 1 64 36" fill="none" stroke="var(--crm-border)" strokeWidth="7" strokeLinecap="round" pathLength="100" /><path d="M8 36 A28 28 0 0 1 64 36" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.min(100, progress)} 100`} /><line x1="36" y1="36" x2={36 + 22 * Math.cos(Math.PI - (progress / 100) * Math.PI)} y2={36 - 22 * Math.sin((progress / 100) * Math.PI)} stroke="var(--crm-ink)" strokeWidth="2" strokeLinecap="round" /><circle cx="36" cy="36" r="3" fill="var(--crm-ink)" /></svg><strong className={`mt-1 font-extrabold tracking-[-0.03em] ${String(value).length > 11 ? 'text-[11px]' : 'text-[20px]'}`}>{value}</strong><span className="mt-1 text-[9px] font-semibold text-[var(--crm-success)]">{Math.round(progress)}% of target path</span></div>
}

function LeadSourcePerformance({ report }: { report: OperatingReport }) {
  const sources = buildAcquisitionSourceRows(report.marketing.sources)
  const total = sources.reduce((sum, row) => sum + row.leads, 0)
  const gradient = conicGradient(sources.map((row) => row.leads), SOURCE_COLORS)
  return (
    <div className="grid min-h-[190px] min-w-0 gap-2 p-3 lg:grid-cols-[188px_minmax(0,1fr)]">
      <div className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
        <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: gradient }}>
          <div className="grid h-[60px] w-[60px] place-items-center rounded-full bg-[var(--crm-surface)] text-center">
            <strong className="text-lg font-extrabold">{total}</strong>
            <span className="text-[8px] font-bold uppercase text-[var(--crm-text-muted)]">Leads</span>
          </div>
        </div>
        <div className="min-w-0 space-y-1.5">
          {sources.map((row, index) => (
            <div key={row.key} className="flex min-w-0 items-center gap-1.5 text-[8px]">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SOURCE_COLORS[index] }} />
              <span className="truncate font-semibold">{row.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[520px] table-fixed text-[9px]">
          <colgroup><col className="w-[29%]" /><col className="w-[11%]" /><col className="w-[13%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[17%]" /></colgroup>
          <thead className="text-[8px] uppercase text-[var(--crm-text-muted)]"><tr><th className="border-b border-[var(--crm-border)] py-2 text-left">Lead source</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Leads</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Qualified</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Appointments</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Contracts</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Revenue</th></tr></thead>
          <tbody>{sources.map((row) => <tr key={row.key} className="border-b border-[var(--crm-border)]"><td className="truncate py-2 pr-2 font-bold">{row.label}</td><td className="py-2 text-right">{row.leads}</td><td className="py-2 text-right">{row.qualified}</td><td className="py-2 text-right">{row.appointments}</td><td className="py-2 text-right">{row.contracts}</td><td className="py-2 text-right font-bold text-[var(--crm-success)]">{money(row.revenue)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function QualificationStatus({ report }: { report: OperatingReport }) {
  const active = Math.max(0, report.acquisitions.total - report.acquisitions.notLeads)
  const reasons = report.acquisitions.unqualifiedReasons.slice(0, 6)
  const bySource = report.acquisitions.unqualifiedBySource.slice(0, 5)
  return <div className="grid min-h-[190px] gap-4 p-3 sm:grid-cols-[0.82fr_1.18fr]"><div><div className="grid grid-cols-3 gap-2"><MiniKpi label="Active" value={active} tone="green" /><MiniKpi label="Qualified" value={report.acquisitions.qualified} tone="blue" /><MiniKpi label="Not leads" value={report.acquisitions.notLeads} tone="coral" /></div><p className="mt-3 text-[8px] font-bold uppercase text-[var(--crm-text-muted)]">Not-lead reasons</p>{reasons.length === 0 ? <p className="mt-4 text-center text-[9px] text-[var(--crm-text-muted)]">No not-lead outcomes recorded</p> : <div className="mt-1 divide-y divide-[var(--crm-border)]">{reasons.map((row) => <DataRow key={row.reason} label={row.reason} value={row.count} />)}</div>}</div><div><p className="text-[8px] font-bold uppercase text-[var(--crm-text-muted)]">Not leads by source</p>{bySource.length === 0 ? <div className="mt-10 text-center text-[9px] text-[var(--crm-text-muted)]">No source-level unqualified records</div> : <div className="mt-2 space-y-3">{bySource.map((row, index) => <BarRow key={row.source} label={formatLeadSource(row.source)} value={row.count} max={Math.max(...bySource.map((item) => item.count), 1)} color={SOURCE_COLORS[index]} />)}</div>}</div></div>
}

function ActivityPerformance({ report }: { report: OperatingReport }) {
  const rows = [
    { icon: 'call', label: 'Completed calls', value: report.communications.calls, tone: 'blue' as const },
    { icon: 'timer', label: 'Avg call duration', value: formatDuration(report.communications.averageCallDurationSeconds), tone: 'violet' as const },
    { icon: 'schedule', label: 'Call minutes', value: formatDuration(report.communications.callDurationSeconds), tone: 'teal' as const },
    { icon: 'sms', label: 'Completed SMS', value: report.communications.outboundSms, tone: 'green' as const },
    { icon: 'event_available', label: 'Appointments', value: report.acquisitions.appointmentsRecorded, tone: 'amber' as const },
    { icon: 'request_quote', label: 'Offers made', value: report.acquisitions.offers, tone: 'coral' as const },
    { icon: 'contract', label: 'Contracts', value: report.acquisitions.contracts, tone: 'red' as const },
    { icon: 'history_toggle_off', label: 'No activity', value: report.acquisitions.dataQuality.noActivity, tone: 'coral' as const },
  ]
  return <div className="grid min-h-[190px] grid-cols-2 divide-x divide-y divide-[var(--crm-border)] sm:grid-cols-4">{rows.map((row) => <div key={row.label} className="flex min-h-24 items-center gap-2 px-3 py-2"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${TONES[row.tone].icon}`}><Icon name={row.icon} className="text-[16px]" /></span><span className="min-w-0"><strong className={`block font-extrabold tracking-[-0.03em] ${String(row.value).length > 10 ? 'text-[12px]' : 'text-[20px]'}`}>{row.value}</strong><span className="block text-[8px] font-semibold text-[var(--crm-text-muted)]">{row.label}</span></span></div>)}</div>
}

function AcquisitionFunnel({ report }: { report: OperatingReport }) {
  const colors = ['#1769e0', '#6d28d9', '#0b9348', '#e3a008', '#f05a28', '#d62937']
  const stages = buildFunnelGeometry(report.acquisitions.stages)
  if (stages.length === 0) return <EmptyState title="No funnel activity" detail="No acquisition stages were recorded for this period." />

  return (
    <div className="flex min-h-[268px] items-center justify-center p-3">
      <svg
        viewBox="0 0 600 264"
        role="img"
        aria-labelledby="acquisition-funnel-title acquisition-funnel-description"
        className="h-auto w-full max-w-[760px] overflow-visible"
      >
        <title id="acquisition-funnel-title">Lead-to-close acquisition funnel</title>
        <desc id="acquisition-funnel-description">A centered, symmetrical funnel with equally spaced stages. Width represents the share of recorded leads remaining at each stage.</desc>
        <line x1={FUNNEL_CENTER_X} x2={FUNNEL_CENTER_X} y1="6" y2="258" stroke="var(--crm-border)" strokeDasharray="2 3" />
        {stages.map((stage, index) => {
          const stageRecord = report.acquisitions.stages[index]
          const stagePercent = index === 0 ? '100%' : percent(stage.value, report.acquisitions.total)
          const centerY = stage.topY + FUNNEL_STAGE_HEIGHT / 2
          return (
            <a
              href={stageHref(stageRecord.key)}
              key={stageRecord.key}
              aria-label={`${stage.label}: ${stage.value}, ${stagePercent} of leads`}
              className="group cursor-pointer outline-none"
            >
              <polygon
                points={`${stage.topLeft},${stage.topY} ${stage.topRight},${stage.topY} ${stage.bottomRight},${stage.bottomY} ${stage.bottomLeft},${stage.bottomY}`}
                fill={colors[index]}
                className="transition-[filter] group-hover:brightness-105 group-focus-visible:brightness-110"
              />
              <line
                x1="92"
                x2={stage.topLeft - 8}
                y1={centerY}
                y2={centerY}
                stroke="var(--crm-border-strong)"
                strokeWidth="1"
              />
              <line
                x1={stage.topRight + 8}
                x2="508"
                y1={centerY}
                y2={centerY}
                stroke="var(--crm-border-strong)"
                strokeWidth="1"
              />
              <text x="84" y={centerY + 3} textAnchor="end" fill="var(--crm-text)" className="text-[10px] font-bold">
                {stage.label}
              </text>
              <text x="516" y={centerY + 3} fill="var(--crm-text)" className="text-[10px] font-extrabold">
                {stage.value}
              </text>
              <text x="550" y={centerY + 3} fill="var(--crm-text-muted)" className="text-[9px] font-semibold">
                {stagePercent}
              </text>
            </a>
          )
        })}
        {stages.map((stage) => (
          <line
            key={`boundary-${stage.index}`}
            x1={stage.topLeft}
            x2={stage.topRight}
            y1={stage.topY}
            y2={stage.topY}
            stroke="white"
            strokeOpacity="0.9"
            strokeWidth="1.5"
            pointerEvents="none"
          />
        ))}
      </svg>
    </div>
  )
}

function AgentScorecard({ report }: { report: OperatingReport }) {
  const communication = new Map(report.communications.agents.map((row) => [row.agent.toLowerCase(), row]))
  if (report.acquisitions.agents.length === 0) return <EmptyState title="No assigned acquisition leads" detail="Agent ownership has not been recorded for this period." />
  return <div className="overflow-x-auto p-3"><table className="w-full min-w-[760px] text-[9px]"><thead className="text-[8px] uppercase text-[var(--crm-text-muted)]"><tr><th className="border-b border-[var(--crm-border)] py-2 text-left">Agent</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Leads</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Qualified</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Appointments</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Contracts</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Calls</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Connected</th><th className="border-b border-[var(--crm-border)] py-2 text-right">Avg duration</th></tr></thead><tbody>{report.acquisitions.agents.map((row) => { const activity = communication.get(row.agent.toLowerCase()); return <tr key={row.agent} className="border-b border-[var(--crm-border)]"><td className="py-2 font-bold">{row.agent}</td><td className="py-2 text-right">{row.leads}</td><td className="py-2 text-right">{row.qualified}</td><td className="py-2 text-right">{row.appointments}</td><td className="py-2 text-right font-bold text-[var(--crm-success)]">{row.contracts}</td><td className="py-2 text-right">{activity?.calls ?? 0}</td><td className="py-2 text-right">{activity?.connected ?? 0}</td><td className="py-2 text-right">{formatDuration(activity?.averageCallDurationSeconds ?? null)}</td></tr> })}</tbody></table></div>
}

function CostEfficiency({ report }: { report: OperatingReport }) {
  const rows = [
    ['Recorded acquisition spend', nullableMoney(report.acquisitions.costs.recordedSpend)],
    ['Cost per lead', nullableMoney(report.acquisitions.costs.costPerLead)],
    ['Cost per opportunity', nullableMoney(report.acquisitions.costs.costPerOpportunity)],
    ['Cost per transaction', nullableMoney(report.acquisitions.costs.costPerTransaction)],
  ] as Array<[string, string]>
  return <div className="p-3"><div className="grid grid-cols-2 gap-2">{rows.map(([label, value], index) => <div key={label} className="rounded-md border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2"><span className="block text-[8px] font-bold text-[var(--crm-text-muted)]">{label}</span><strong className={`mt-1 block tracking-[-0.035em] ${value.length > 12 ? 'text-[12px]' : 'text-lg'}`} style={{ color: TONES[index === 0 ? 'green' : index === 1 ? 'blue' : index === 2 ? 'violet' : 'coral'].color }}>{value}</strong></div>)}</div><p className="mt-2 text-[8px] leading-3 text-[var(--crm-text-muted)]">Uses only recorded acquisition and marketing expense rows. Google Ads, PPC, direct mail, lead vendors, and related acquisition categories are included; missing spend is never inferred.</p></div>
}

function RevenueLift({ report }: { report: OperatingReport }) {
  const model = buildRevenueLiftModel(report)
  const rows = [
    ['Lead qualification rate', model.currentRates.qualification, model.optimizedRates.qualification],
    ['Opportunity → appointment', model.currentRates.appointment, model.optimizedRates.appointment],
    ['Appointment → contract', model.currentRates.contract, model.optimizedRates.contract],
    ['Contract → assignment', model.currentRates.assignment, model.optimizedRates.assignment],
    ['Assignment → closing', model.currentRates.close, model.optimizedRates.close],
  ] as Array<[string, number, number]>
  return <div className="grid gap-3 p-3 md:grid-cols-[1.25fr_0.75fr]"><div><div className="grid grid-cols-[1fr_76px_88px_60px] gap-2 border-b border-[var(--crm-border)] pb-1 text-[8px] font-bold uppercase text-[var(--crm-text-muted)]"><span>Metric</span><span className="text-right">Current</span><span className="text-right">Benchmark</span><span className="text-right">Gap</span></div>{rows.map(([label, current, optimized]) => <div key={label} className="grid grid-cols-[1fr_76px_88px_60px] gap-2 border-b border-[var(--crm-border)] py-2 text-[9px]"><span className="font-semibold">{label}</span><strong className="text-right">{current}%</strong><strong className="text-right text-[var(--crm-success)]">{optimized}%</strong><span className={`text-right font-bold ${optimized - current > 0 ? 'text-[var(--crm-info)]' : 'text-[var(--crm-success)]'}`}>{signed(optimized - current)} pts</span></div>)}</div><div className="rounded-md bg-[var(--crm-success-soft)] p-3"><span className="text-[8px] font-bold uppercase text-[var(--crm-success)]">Modeled outcome</span><strong className="mt-1 block text-[21px] font-extrabold tracking-[-0.04em] text-[var(--crm-success)]">{model.revenueLift == null ? 'Not recorded' : money(model.revenueLift)}</strong><span className="text-[8px] text-[var(--crm-text-muted)]">Potential lift at benchmark rates</span><div className="mt-3 space-y-1.5"><DataRow label="Avg deal margin" value={nullableMoney(model.averageDealMargin)} /><DataRow label="Current closings" value={model.currentClosings} /><DataRow label="Projected closings" value={model.projectedClosings == null ? 'Not modeled' : model.projectedClosings.toFixed(1)} /></div></div><p className="md:col-span-2 text-[8px] leading-3 text-[var(--crm-text-muted)]">Benchmark rates come from the supplied Left Main operating model. This is a transparent scenario, not booked revenue or an AI prediction.</p></div>
}

function ProcessMetrics() {
  const stages = [
    { label: 'Lead', tone: 'blue' as const, items: ['Lead quality', 'Speed to first action', 'Time to conversation', 'Activities and last touch', 'Omnichannel follow-up'] },
    { label: 'Opportunity', tone: 'violet' as const, items: ['Appointment obstacle', 'Time to set appointment', 'Personal handoff', 'Email and SMS confirmation', 'Rep picture and follow-up'] },
    { label: 'Appointment', tone: 'green' as const, items: ['Sales process', 'Time to appointment', 'Time to offer', 'Contract', 'Post-offer follow-up'] },
    { label: 'Deal', tone: 'coral' as const, items: ['Transaction handoff', 'Closing coordination', 'Debrief', 'Closed-loop reporting'] },
  ]
  return <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">{stages.map((stage, index) => <div key={stage.label} className="relative rounded-md border border-[var(--crm-border)] p-3"><div className="mb-2 flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full text-[9px] font-black text-white`} style={{ background: TONES[stage.tone].color }}>{index + 1}</span><strong className="text-[10px] uppercase" style={{ color: TONES[stage.tone].color }}>{stage.label}</strong></div><ul className="space-y-1.5">{stage.items.map((item) => <li key={item} className="flex gap-1.5 text-[8px] leading-3"><Icon name="check_circle" className="text-[11px] text-[var(--crm-success)]" /><span>{item}</span></li>)}</ul></div>)}</div>
}

function AcquisitionConstraints({ report }: { report: OperatingReport }) {
  const rows = report.bottlenecks.filter((row) => row.department === 'Acquisitions')
  return <div className="grid gap-2 p-3 sm:grid-cols-2">{rows.length === 0 ? <div className="sm:col-span-2"><EmptyState title="No active acquisition constraints" detail="The recorded attention checks are clear." /></div> : rows.map((row) => <Link key={row.key} href={row.href} className="rounded-md border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3 hover:border-[var(--crm-brand-border)]"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${row.severity === 'high' ? 'bg-[var(--crm-danger)]' : row.severity === 'medium' ? 'bg-[var(--crm-warning)]' : 'bg-[var(--crm-success)]'}`} /><strong className="min-w-0 flex-1 truncate text-[9px]">{row.label}</strong><span className="text-lg font-extrabold">{row.count}</span></div><span className="mt-1 block text-[8px] capitalize text-[var(--crm-text-muted)]">{row.severity} priority</span></Link>)}</div>
}

function MiniKpi({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return <div className="rounded-md border border-[var(--crm-border)] p-2 text-center" style={{ background: `color-mix(in srgb, ${TONES[tone].color} 7%, var(--crm-surface))` }}><strong className="block text-xl font-extrabold">{value}</strong><span className="text-[8px] font-bold text-[var(--crm-text-muted)]">{label}</span></div>
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return <div><div className="mb-1 flex justify-between text-[8px]"><span className="font-semibold">{label}</span><strong>{value}</strong></div><div className="h-2 rounded-full bg-[var(--crm-surface-subtle)]"><span className="block h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} /></div></div>
}

function DataRow({ label, value }: { label: string; value: string | number }) {
  return <div className="flex items-center justify-between gap-2 py-1 text-[9px]"><span className="font-medium text-[var(--crm-text-muted)]">{label}</span><strong className="text-right">{value}</strong></div>
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="grid min-h-[170px] place-items-center px-4 text-center"><div><Icon name="data_alert" className="text-2xl text-[var(--crm-text-muted)]" /><strong className="mt-2 block text-[11px]">{title}</strong><span className="mt-1 block text-[9px] text-[var(--crm-text-muted)]">{detail}</span></div></div>
}

function MiniSparkline({ series, color, label }: { series: OperatingReport['trends']['leads']; color: string; label: string }) {
  const values = series.map((point) => point.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 138},${28 - ((value - min) / span) * 24}`).join(' ')
  return <svg role="img" aria-label={label} viewBox="0 0 138 32" className="h-7 w-full"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function conicGradient(values: number[], colors: string[]) {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total === 0) return 'var(--crm-surface-subtle)'
  let cursor = 0
  const stops = values.map((value, index) => {
    const start = cursor
    cursor += (value / total) * 100
    return `${colors[index % colors.length]} ${start}% ${cursor}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}

function acquisitionSourceChannel(source: string): AcquisitionSourceChannel | null {
  const value = source.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (/(tax_?delinquent|delinquent_?tax|ppc_?tax|tax_?ppc)/.test(value)) return 'google_tax_delinquent'
  if (/google_?ads|googleads|gclid|paid_?search|(^|_)ppc(_|$)/.test(value)) return 'google_general'
  if (/youtube|you_?tube/.test(value)) return 'youtube'
  if (/outbound|cold_?call|mojo|dialer/.test(value)) return 'cold_calls'
  if (/(sms|text)/.test(value)) return 'sms_outreach'
  return null
}

function rate(numerator: number, denominator: number) { return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0 }
function percent(numerator: number, denominator: number) { return denominator > 0 ? `${rate(numerator, denominator)}%` : '—' }
function nullablePercent(value: number | null) { return value == null ? 'Not recorded' : `${value}%` }
function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) }
function nullableMoney(value: number | null) { return value == null ? 'Not recorded' : money(value) }
function compactNumber(value: number) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value) }
function formatMinutes(value: number | null) { return value == null ? 'Not recorded' : value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m` }
function formatDuration(value: number | null) { if (value == null) return 'Not recorded'; const minutes = Math.floor(value / 60); const seconds = Math.round(value % 60); return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s` }
function signed(value: number) { return value > 0 ? `+${value}` : String(value) }
function inverseProgress(actual: number | null, target: number) { if (actual == null) return 0; if (actual <= target) return 100; return Math.max(0, Math.round((target / actual) * 100)) }
function seriesMomentum(series: OperatingReport['trends']['leads']): number | null { if (series.length < 2) return null; const middle = Math.floor(series.length / 2); const previous = series.slice(0, middle).reduce((sum, point) => sum + point.value, 0); const current = series.slice(middle).reduce((sum, point) => sum + point.value, 0); if (previous === 0) return current > 0 ? 100 : null; return Math.round(((current - previous) / previous) * 100) }
function scaledGoal(goal: number | null, report: OperatingReport, cadence: 'daily' | 'weekly' | 'monthly') { if (goal == null || report.period.since == null) return goal; const days = Math.max(1, (new Date(report.period.until).getTime() - new Date(report.period.since).getTime()) / 86_400_000); if (cadence === 'daily') return Math.round(goal * days * (5 / 7)); if (cadence === 'weekly') return Math.round(goal * (days / 7)); return Math.round(goal * (days / 30)) }
function stageHref(key: string) { const map: Record<string, string> = { leads: '/contacts', qualified: '/contacts?min_stage=qualified', appointments: '/contacts?min_stage=appointment_set', offers: '/contacts?min_stage=offer_made', contracts: '/contacts?min_stage=under_contract', closed: '/contacts?stage=closed_won' }; return map[key] ?? '/contacts' }
