'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import type { PpcReport } from '@/lib/marketing/ppc-report'
import { GOOGLE_ADS_QUALITY_SCALE, type GoogleAdsQualityScore } from '@/lib/ppc/conversion-approval'

const PERIODS = [
  { value: 1, label: 'Today', helper: 'Last 24h' },
  { value: 7, label: 'Last 7 days', helper: '1 week' },
  { value: 30, label: 'Last 30 days', helper: '1 month' },
  { value: 90, label: 'Last 90 days', helper: 'Quarter' },
  { value: 180, label: 'Last 180 days', helper: 'Long view' },
] as const

const TOP_JOURNEY_LIMIT = 6
const TOP_DRIVER_LIMIT = 5

type LoadState =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: PpcReport; error: null }
  | { status: 'error'; data: null; error: string }

type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'info'

type ActionItem = {
  key: string
  icon: string
  title: string
  value: string
  detail: string
  tone: Tone
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatPct(value: number | null): string {
  if (value == null) return '--'
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`
}

function formatDate(value: string | null): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(value: string | null): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatAgeHours(value: number | null): string {
  if (value == null) return '--'
  if (value < 1) return '<1h'
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}h`
}

function formatAgeMinutes(value: number | null): string {
  if (value == null) return '--'
  if (value < 60) return `${value}m`
  const hours = Math.round((value / 60) * 10) / 10
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`
}

function periodLabel(days: number): string {
  return PERIODS.find((period) => period.value === days)?.label ?? `${days} days`
}

function countSummary(shown: number, total: number): string {
  if (total <= shown) return `Showing ${formatNumber(shown)}`
  return `Showing ${formatNumber(shown)} of ${formatNumber(total)}`
}

function compactText(value: string): string {
  return value === '--' ? '--' : value.replace(/-/g, ' ')
}

function toneClasses(tone: Tone): string {
  if (tone === 'good') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (tone === 'warn') return 'border-amber-500/35 bg-amber-500/10 text-amber-200'
  if (tone === 'bad') return 'border-[#E32E2E]/45 bg-[#E32E2E]/12 text-[#FCA5A5]'
  if (tone === 'info') return 'border-sky-500/30 bg-sky-500/10 text-sky-200'
  return 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]'
}

function statusDotClass(status: PpcReport['journeySessions'][number]['steps'][number]['status']): string {
  if (status === 'complete') return 'bg-emerald-400'
  if (status === 'active') return 'bg-amber-300'
  return 'bg-[var(--ck-border-strong)]'
}

function deadlineStatusClass(status: PpcReport['conversionApprovalQueue'][number]['deadlineStatus']): string {
  if (status === 'expired') return 'border-[#E32E2E]/45 bg-[#E32E2E]/15 text-[#FCA5A5]'
  if (status === 'critical') return 'border-orange-500/40 bg-orange-500/15 text-orange-200'
  if (status === 'urgent') return 'border-amber-500/40 bg-amber-500/15 text-amber-200'
  if (status === 'review') return 'border-sky-500/35 bg-sky-500/10 text-sky-200'
  return 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]'
}

function deadlineLabel(row: PpcReport['conversionApprovalQueue'][number]): string {
  if (row.deadlineStatus === 'expired') return 'Expired'
  if (row.daysLeft == null) return 'No deadline'
  return `${row.daysLeft}d left`
}

function scoreLabel(score: GoogleAdsQualityScore): string {
  const item = GOOGLE_ADS_QUALITY_SCALE.find((option) => option.score === score)
  return item ? `${item.score} - ${item.title}` : String(score)
}

function usePpcReport(days: number, refreshKey: number): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setState({ status: 'loading', data: null, error: null })
    })

    fetch(`/api/marketing/ppc-report?days=${days}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Request failed: ${res.status}`)
        }
        return res.json() as Promise<PpcReport>
      })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            data: null,
            error: error instanceof Error ? error.message : 'Failed to load PPC report',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [days, refreshKey])

  return state
}

function decisionBrief(report: PpcReport): { tone: Tone; icon: string; label: string; headline: string; detail: string } {
  const paidJourneys = report.resultCounts.journeySessionsTotal

  if (report.exportHealth.failed + report.exportHealth.deadLetter > 0) {
    return {
      tone: 'bad',
      icon: 'error',
      label: 'Fix first',
      headline: 'Conversion export has failures.',
      detail: `${formatNumber(report.exportHealth.failed + report.exportHealth.deadLetter)} failed or dead-letter rows need cleanup before trusting Google feedback.`,
    }
  }

  if (report.exportHealth.awaitingApproval > 0) {
    return {
      tone: 'warn',
      icon: 'approval',
      label: 'Decision needed',
      headline: 'Approve quality conversions.',
      detail: `${formatNumber(report.exportHealth.awaitingApproval)} conversion${report.exportHealth.awaitingApproval === 1 ? '' : 's'} waiting for Google Ads quality scoring.`,
    }
  }

  if (paidJourneys > 0 && report.summary.totalLeads === 0) {
    return {
      tone: 'warn',
      icon: 'conversion_path',
      label: 'Traffic leak',
      headline: 'Paid clicks are not becoming CRM leads.',
      detail: `${formatNumber(paidJourneys)} click-ID journey${paidJourneys === 1 ? '' : 's'} found, but no PPC lead was created in this window.`,
    }
  }

  if (report.summary.stage3NoSubmit > 0) {
    return {
      tone: 'info',
      icon: 'edit_note',
      label: 'Follow-up pool',
      headline: 'Some sellers reached the serious step but did not submit.',
      detail: `${formatNumber(report.summary.stage3NoSubmit)} Step 3 signal${report.summary.stage3NoSubmit === 1 ? '' : 's'} may be worth manual review.`,
    }
  }

  if (paidJourneys === 0 && report.summary.paidVisits === 0) {
    return {
      tone: 'neutral',
      icon: 'do_not_disturb_on',
      label: 'No signal',
      headline: 'No paid-search activity in this window.',
      detail: 'The dashboard is quiet because no paid click or PPC lead signal was logged.',
    }
  }

  return {
    tone: 'good',
    icon: 'check_circle',
    label: 'Clean',
    headline: 'No critical PPC blockers right now.',
    detail: 'Traffic, leads, approvals, and export health do not show an urgent issue in this window.',
  }
}

function criticalActions(report: PpcReport): ActionItem[] {
  const items: ActionItem[] = []
  const failedExports = report.exportHealth.failed + report.exportHealth.deadLetter

  if (failedExports > 0) {
    items.push({
      key: 'failed-exports',
      icon: 'sync_problem',
      title: 'Failed exports',
      value: formatNumber(failedExports),
      detail: 'Google feedback is blocked until these are fixed.',
      tone: 'bad',
    })
  }

  if (report.exportHealth.awaitingApproval > 0) {
    items.push({
      key: 'awaiting-approval',
      icon: 'approval',
      title: 'Needs approval',
      value: formatNumber(report.exportHealth.awaitingApproval),
      detail: 'Score these before the export worker sends them.',
      tone: 'warn',
    })
  }

  if (report.summary.stage3NoSubmit > 0) {
    items.push({
      key: 'stage3',
      icon: 'edit_note',
      title: 'Step 3, no submit',
      value: formatNumber(report.summary.stage3NoSubmit),
      detail: 'High-intent sellers who did not finish the final submit.',
      tone: 'info',
    })
  }

  if (report.dataQuality.missingClickIdRows > 0) {
    items.push({
      key: 'missing-click-id',
      icon: 'key_off',
      title: 'Missing click IDs',
      value: formatNumber(report.dataQuality.missingClickIdRows),
      detail: 'Leads without a Google click ID cannot be tied back cleanly.',
      tone: 'warn',
    })
  }

  if (!report.exportConfig.configured) {
    items.push({
      key: 'export-config',
      icon: 'settings_input_component',
      title: 'Export destination',
      value: 'Setup',
      detail: 'The worker does not have a complete live destination.',
      tone: 'bad',
    })
  }

  if (items.length === 0) {
    items.push({
      key: 'clean',
      icon: 'verified',
      title: 'No urgent work',
      value: 'Clear',
      detail: 'No approvals, failed exports, or major tracking gaps need action.',
      tone: 'good',
    })
  }

  return items.slice(0, 4)
}

function funnelSteps(report: PpcReport): Array<{ key: string; label: string; count: number; detail: string }> {
  return [
    {
      key: 'paid-clicks',
      label: 'Paid click IDs',
      count: report.resultCounts.journeySessionsTotal,
      detail: `${formatNumber(report.resultCounts.journeySessionsHiddenNoClickId)} no-ID sessions hidden`,
    },
    {
      key: 'submits',
      label: 'Final submits',
      count: report.summary.formSubmits,
      detail: `${formatPct(report.summary.submitRate)} submit rate`,
    },
    {
      key: 'appointments',
      label: 'Appointments',
      count: report.summary.appointments,
      detail: `${formatPct(report.summary.appointmentRate)} of leads`,
    },
    {
      key: 'contracts',
      label: 'Contracts',
      count: report.summary.contracts,
      detail: formatMoney(report.summary.revenue),
    },
  ]
}

function journeyProgress(session: PpcReport['journeySessions'][number]): { complete: number; total: number; current: string } {
  const complete = session.steps.filter((step) => step.status === 'complete').length
  const active = session.steps.find((step) => step.status === 'active')
  const lastComplete = [...session.steps].reverse().find((step) => step.status === 'complete')
  return {
    complete,
    total: session.steps.length,
    current: active?.label || lastComplete?.label || 'Ad click',
  }
}

function dailySignalValue(day: PpcReport['daily'][number]): number {
  return day.leads + day.formSubmits + day.ppcCalls + day.appointments
}

export default function MarketingPage() {
  const [days, setDays] = useState<number>(30)
  const [refreshKey, setRefreshKey] = useState(0)
  const [approvalMessage, setApprovalMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const state = usePpcReport(days, refreshKey)
  const report = state.status === 'ready' ? state.data : null

  const brief = useMemo(() => (report ? decisionBrief(report) : null), [report])
  const actions = useMemo(() => (report ? criticalActions(report) : []), [report])
  const steps = useMemo(() => (report ? funnelSteps(report) : []), [report])
  const latestJourneys = report?.journeySessions.slice(0, TOP_JOURNEY_LIMIT) ?? []
  const topDrivers = report?.attributionRows.slice(0, TOP_DRIVER_LIMIT) ?? []

  return (
    <div className="min-h-screen bg-[var(--ck-bg)] text-[var(--ck-text)]">
      <div className="mx-auto w-full max-w-[1360px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#E32E2E]">
              <Icon name="monitoring" size="text-base" />
              Search 2026
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Marketing Command</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--ck-text-muted)]">
              A short read on what is working, what needs action, and where paid sellers drop.
            </p>
          </div>

          <div className="flex flex-col gap-1 sm:min-w-[232px]">
            <label htmlFor="marketing-period" className="text-xs font-black uppercase tracking-wide text-[var(--ck-text-dim)]">
              Reporting window
            </label>
            <select
              id="marketing-period"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="h-11 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 text-sm font-black text-[var(--ck-text)] outline-none transition focus:border-[#E32E2E]"
            >
              {PERIODS.map((period) => (
                <option key={period.value} value={period.value}>
                  {period.label} - {period.helper}
                </option>
              ))}
            </select>
          </div>
        </header>

        {state.status === 'loading' && (
          <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-8 text-center text-sm text-[var(--ck-text-muted)]">
            Loading marketing command...
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-lg border border-[#E32E2E]/40 bg-[#E32E2E]/10 p-5 text-sm text-[#FCA5A5]">
            {state.error}
          </div>
        )}

        {report && brief && (
          <div className="space-y-5 pb-20">
            <section className="grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
              <ExecutiveBrief report={report} brief={brief} days={days} />
              <CriticalWork items={actions} />
            </section>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <CoreMetric
                icon="ads_click"
                label="Paid journeys"
                value={formatNumber(report.resultCounts.journeySessionsTotal)}
                detail={`${countSummary(report.resultCounts.journeySessionsShown, report.resultCounts.journeySessionsTotal)} click-ID paths`}
                tone="info"
              />
              <CoreMetric
                icon="person_add"
                label="Lead capture"
                value={formatNumber(report.summary.totalLeads)}
                detail={`${formatNumber(report.summary.formSubmits)} final submits · ${formatPct(report.summary.submitRate)}`}
                tone={report.summary.totalLeads > 0 ? 'good' : 'neutral'}
              />
              <CoreMetric
                icon="event_available"
                label="Appointments"
                value={formatNumber(report.summary.appointments)}
                detail={`${formatNumber(report.summary.contracts)} contracts`}
                tone={report.summary.appointments > 0 ? 'good' : 'neutral'}
              />
              <CoreMetric
                icon="payments"
                label="Revenue"
                value={formatMoney(report.summary.revenue)}
                detail={`${formatNumber(report.summary.call2m)} calls at 2m+`}
                tone={report.summary.revenue > 0 ? 'good' : 'neutral'}
              />
            </section>

            <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
              <FunnelSection steps={steps} daily={report.daily} />
              <SystemIntegrity report={report} />
            </section>

            <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <LatestJourneys sessions={latestJourneys} total={report.resultCounts.journeySessionsTotal} />
              <TopDrivers rows={topDrivers} total={report.resultCounts.attributionRowsTotal} shown={report.resultCounts.attributionRowsShown} />
            </section>

            {report.conversionApprovalQueue.length > 0 && (
              <ApprovalQueuePanel
                report={report}
                message={approvalMessage}
                onMessage={setApprovalMessage}
                onApproved={() => setRefreshKey((value) => value + 1)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ExecutiveBrief({
  report,
  brief,
  days,
}: {
  report: PpcReport
  brief: ReturnType<typeof decisionBrief>
  days: number
}) {
  return (
    <section className={`rounded-lg border p-5 ${toneClasses(brief.tone)}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-current/25 bg-black/10 px-2.5 py-1 text-xs font-black uppercase tracking-wide">
            <Icon name={brief.icon} size="text-base" />
            {brief.label}
          </div>
          <h2 className="max-w-3xl text-2xl font-black tracking-tight text-[var(--ck-text)] sm:text-3xl">
            {brief.headline}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ck-text-muted)]">{brief.detail}</p>
        </div>
        <div className="grid min-w-[260px] grid-cols-2 gap-2 text-sm">
          <SignalPill label="Window" value={periodLabel(days)} />
          <SignalPill label="Range" value={`${formatDate(report.period.since)}-${formatDate(report.period.until)}`} />
          <SignalPill label="Click ID" value={formatPct(report.dataQuality.clickIdCoverage)} />
          <SignalPill label="Actions" value={formatNumber(report.exportHealth.awaitingApproval + report.exportHealth.failed + report.exportHealth.deadLetter)} />
        </div>
      </div>
    </section>
  )
}

function SignalPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--ck-border)] bg-[var(--ck-bg)]/40 px-3 py-2">
      <div className="text-[11px] font-black uppercase tracking-wide text-[var(--ck-text-dim)]">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-[var(--ck-text)]">{value}</div>
    </div>
  )
}

function CriticalWork({ items }: { items: ActionItem[] }) {
  return (
    <section className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
      <SectionTitle icon="priority_high" title="Critical Work" />
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border px-3 py-3 ${toneClasses(item.tone)}`}>
            <Icon name={item.icon} size="text-xl" />
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-[var(--ck-text)]">{item.title}</div>
              <div className="mt-0.5 truncate text-xs text-[var(--ck-text-muted)]">{item.detail}</div>
            </div>
            <div className="text-right text-xl font-black tabular-nums text-[var(--ck-text)]">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function CoreMetric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: string
  label: string
  value: string
  detail: string
  tone: Tone
}) {
  return (
    <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-wide text-[var(--ck-text-dim)]">{label}</div>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClasses(tone)}`}>
          <Icon name={icon} size="text-lg" />
        </div>
      </div>
      <div className="text-3xl font-black tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-xs font-medium text-[var(--ck-text-muted)]">{detail}</div>
    </div>
  )
}

function FunnelSection({
  steps,
  daily,
}: {
  steps: Array<{ key: string; label: string; count: number; detail: string }>
  daily: PpcReport['daily']
}) {
  const maxCount = Math.max(...steps.map((step) => step.count), 1)
  return (
    <section className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
      <SectionTitle icon="filter_alt" title="Funnel That Matters" />
      <div className="space-y-3">
        {steps.map((step, index) => {
          const previous = index === 0 ? null : steps[index - 1]
          const rate = previous && previous.count > 0 ? (step.count / previous.count) * 100 : null
          return (
            <div key={step.key} className="grid gap-2 sm:grid-cols-[150px_1fr_94px] sm:items-center">
              <div>
                <div className="text-sm font-black">{step.label}</div>
                <div className="text-xs text-[var(--ck-text-dim)]">{step.detail}</div>
              </div>
              <div className="h-8 overflow-hidden rounded-md bg-[var(--ck-surface-elev)]">
                <div
                  className="flex h-full items-center justify-end rounded-md bg-[#E32E2E] px-2 text-xs font-black text-white"
                  style={{ width: `${Math.max((step.count / maxCount) * 100, step.count > 0 ? 8 : 0)}%` }}
                >
                  {step.count > 0 ? formatNumber(step.count) : ''}
                </div>
              </div>
              <div className="text-left text-xs font-black text-[var(--ck-text-muted)] sm:text-right">
                {rate == null ? 'Start' : formatPct(rate)}
              </div>
            </div>
          )
        })}
      </div>
      <DailyPulse days={daily.slice(-10)} />
    </section>
  )
}

function DailyPulse({ days }: { days: PpcReport['daily'] }) {
  const max = Math.max(...days.map(dailySignalValue), 1)
  return (
    <div className="mt-5 border-t border-[var(--ck-border)] pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-black uppercase tracking-wide text-[var(--ck-text-dim)]">Recent pulse</div>
        <div className="text-xs text-[var(--ck-text-muted)]">Leads, submits, calls, appointments</div>
      </div>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {days.map((day) => {
          const value = dailySignalValue(day)
          return (
            <div key={day.date} className="flex min-h-[92px] flex-col justify-end gap-2 rounded-md bg-[var(--ck-surface-elev)] px-2 py-2">
              <div className="flex flex-1 items-end">
                <div
                  className="w-full rounded-sm bg-[#E32E2E]"
                  style={{ height: `${Math.max((value / max) * 100, value > 0 ? 8 : 2)}%` }}
                  title={`${formatDate(`${day.date}T12:00:00.000Z`)}: ${formatNumber(value)} signals`}
                />
              </div>
              <div className="truncate text-center text-[10px] font-bold text-[var(--ck-text-dim)]">{formatDate(`${day.date}T12:00:00.000Z`)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SystemIntegrity({ report }: { report: PpcReport }) {
  const exportWorker = report.operationsHealth.ppcExportWorker
  const missedCalls = report.operationsHealth.googleAdsMissedCalls
  const failedExports = report.exportHealth.failed + report.exportHealth.deadLetter
  const actionCount = report.exportHealth.awaitingApproval + failedExports

  return (
    <section className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
      <SectionTitle icon="verified" title="System Integrity" />
      <div className="space-y-3">
        <IntegrityRow
          icon="key"
          label="Click ID coverage"
          value={formatPct(report.dataQuality.clickIdCoverage)}
          detail={`${formatNumber(report.dataQuality.missingClickIdRows)} PPC leads missing an ID`}
          tone={report.dataQuality.missingClickIdRows > 0 ? 'warn' : 'good'}
        />
        <IntegrityRow
          icon="cloud_upload"
          label="Conversion export"
          value={actionCount > 0 ? `${formatNumber(actionCount)} open` : 'Clear'}
          detail={`${formatNumber(report.exportHealth.approvedPending)} approved pending · oldest ${formatAgeHours(exportWorker.oldestReadyAgeHours)}`}
          tone={failedExports > 0 ? 'bad' : actionCount > 0 ? 'warn' : 'good'}
        />
        <IntegrityRow
          icon="schedule"
          label="Workers"
          value={exportWorker.status === 'healthy' && missedCalls.status === 'healthy' ? 'Healthy' : 'Check'}
          detail={`Export ${exportWorker.schedule.toLowerCase()} · missed calls ${missedCalls.schedule.toLowerCase()}`}
          tone={exportWorker.status === 'blocked' || missedCalls.status === 'blocked' ? 'bad' : exportWorker.status === 'attention' || missedCalls.status === 'attention' ? 'warn' : 'good'}
        />
        <IntegrityRow
          icon="phone_callback"
          label="Missed-call follow-up"
          value={formatNumber(missedCalls.pendingEscalations)}
          detail={`${formatNumber(missedCalls.overdueEscalations)} overdue · oldest ${formatAgeMinutes(missedCalls.oldestDueAgeMinutes)}`}
          tone={missedCalls.overdueEscalations > 0 ? 'bad' : missedCalls.pendingEscalations > 0 ? 'warn' : 'good'}
        />
      </div>
    </section>
  )
}

function IntegrityRow({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: string
  label: string
  value: string
  detail: string
  tone: Tone
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[var(--ck-border)] pb-3 last:border-b-0 last:pb-0">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClasses(tone)}`}>
        <Icon name={icon} size="text-lg" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-black text-[var(--ck-text)]">{label}</div>
        <div className="mt-0.5 truncate text-xs text-[var(--ck-text-muted)]">{detail}</div>
      </div>
      <div className="text-right text-sm font-black text-[var(--ck-text)]">{value}</div>
    </div>
  )
}

function LatestJourneys({
  sessions,
  total,
}: {
  sessions: PpcReport['journeySessions']
  total: number
}) {
  return (
    <section className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
      <SectionTitle icon="conversion_path" title="Latest Paid Journeys" detail={`${formatNumber(sessions.length)} of ${formatNumber(total)} shown`} />
      <div className="space-y-3">
        {sessions.length === 0 ? (
          <EmptyState text="No click-ID paid journeys in this window." />
        ) : sessions.map((session) => (
          <JourneyRow key={session.key} session={session} />
        ))}
      </div>
    </section>
  )
}

function JourneyRow({ session }: { session: PpcReport['journeySessions'][number] }) {
  const progress = journeyProgress(session)
  return (
    <article className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[#E32E2E]/15 px-2 py-1 text-xs font-black text-[#FCA5A5]">{formatTime(session.firstEventAt)}</span>
            <span className="truncate text-sm font-black text-[var(--ck-text)]">{session.campaign}</span>
            <span className="font-mono text-xs text-[var(--ck-text-dim)]">{session.clickId}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs capitalize text-[var(--ck-text-muted)]">
            <span>{progress.complete}/{progress.total} steps</span>
            <span>Current: <b className="text-[var(--ck-text)]">{progress.current}</b></span>
            <span>{compactText(session.choices.situation)}</span>
            <span>{compactText(session.choices.timeline)}</span>
          </div>
        </div>
        {session.leadId ? (
          <Link href={`/leads/${session.leadId}`} className="inline-flex w-fit items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-black text-emerald-200 hover:bg-emerald-500/15">
            <Icon name="person_search" size="text-base" />
            {session.leadName}
          </Link>
        ) : (
          <span className="inline-flex w-fit items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-black text-amber-200">
            <Icon name="person_off" size="text-base" />
            No CRM lead
          </span>
        )}
      </div>
      <div className="grid grid-cols-10 gap-1" aria-label={`${progress.complete} of ${progress.total} journey steps complete`}>
        {session.steps.map((step) => (
          <div key={step.key} className={`h-2 rounded-full ${statusDotClass(step.status)}`} title={`${step.label}: ${step.detail}`} />
        ))}
      </div>
    </article>
  )
}

function TopDrivers({
  rows,
  shown,
  total,
}: {
  rows: PpcReport['attributionRows']
  shown: number
  total: number
}) {
  return (
    <section className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
      <SectionTitle icon="table_chart" title="Top Drivers" detail={`${countSummary(shown, total)} campaign/keyword rows`} />
      <div className="space-y-2">
        {rows.length === 0 ? (
          <EmptyState text="No PPC attribution rows in this window." />
        ) : rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3 border-b border-[var(--ck-border)] py-3 last:border-b-0">
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-[var(--ck-text)]">{row.campaign}</div>
              <div className={`mt-0.5 truncate text-xs ${row.keyword === 'Keyword not passed' ? 'text-amber-300' : 'text-[var(--ck-text-muted)]'}`}>
                {row.keyword}
              </div>
            </div>
            <div className="grid min-w-[220px] grid-cols-4 gap-2 text-right text-xs">
              <DriverStat label="Leads" value={formatNumber(row.leads)} />
              <DriverStat label="Submits" value={formatNumber(row.formSubmits)} />
              <DriverStat label="Appts" value={formatNumber(row.appointments)} />
              <DriverStat label="Revenue" value={formatMoney(row.revenue)} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function DriverStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-black tabular-nums text-[var(--ck-text)]">{value}</div>
      <div className="mt-0.5 uppercase tracking-wide text-[var(--ck-text-dim)]">{label}</div>
    </div>
  )
}

function SectionTitle({ icon, title, detail }: { icon: string; title: string; detail?: string }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Icon name={icon} size="text-lg" className="text-[#E32E2E]" />
        <h2 className="text-sm font-black uppercase tracking-wide text-[var(--ck-text)]">{title}</h2>
      </div>
      {detail && <div className="text-xs font-bold text-[var(--ck-text-muted)]">{detail}</div>}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--ck-border)] p-6 text-center text-sm text-[var(--ck-text-muted)]">
      {text}
    </div>
  )
}

function ApprovalQueuePanel({
  report,
  message,
  onMessage,
  onApproved,
}: {
  report: PpcReport
  message: { tone: 'success' | 'error'; text: string } | null
  onMessage: (message: { tone: 'success' | 'error'; text: string } | null) => void
  onApproved: () => void
}) {
  const [selectedScores, setSelectedScores] = useState<Record<string, GoogleAdsQualityScore>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  async function approve(row: PpcReport['conversionApprovalQueue'][number]) {
    const qualityScore = selectedScores[row.id] ?? row.qualityScore ?? row.suggestedQualityScore
    setBusyId(row.id)
    onMessage(null)

    try {
      const response = await fetch(`/api/marketing/ppc-conversions/${row.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qualityScore }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error || `Approval failed: ${response.status}`)
      onMessage({ tone: 'success', text: `${row.eventLabel} approved with Google Ads score ${qualityScore}.` })
      onApproved()
    } catch (error) {
      onMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Approval failed',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
      <SectionTitle icon="approval" title="Approval Queue" detail={`${formatNumber(report.conversionApprovalQueue.length)} waiting`} />

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <QueueStat label="Awaiting" value={report.conversionApproval.awaitingApproval} tone={report.conversionApproval.awaitingApproval > 0 ? 'warn' : 'good'} />
        <QueueStat label="Urgent" value={report.conversionApproval.urgent + report.conversionApproval.critical} tone={report.conversionApproval.urgent + report.conversionApproval.critical > 0 ? 'bad' : 'good'} />
        <QueueStat label="Expired" value={report.conversionApproval.expired} tone={report.conversionApproval.expired > 0 ? 'bad' : 'good'} />
      </div>

      {message && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-sm font-bold ${
          message.tone === 'success'
            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
            : 'border-[#E32E2E]/40 bg-[#E32E2E]/10 text-[#FCA5A5]'
        }`}>
          {message.text}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ck-border)] text-left text-xs uppercase tracking-wide text-[var(--ck-text-dim)]">
              <th className="py-3 pr-4">Conversion</th>
              <th className="py-3 pr-4">Lead</th>
              <th className="py-3 pr-4">Deadline</th>
              <th className="py-3 pr-4">Google value</th>
              <th className="py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {report.conversionApprovalQueue.map((row) => {
              const selectedScore = selectedScores[row.id] ?? row.qualityScore ?? row.suggestedQualityScore
              const canApprove = row.status !== 'sent' && row.deadlineStatus !== 'expired'

              return (
                <tr key={row.id} className="border-b border-[var(--ck-border)] last:border-b-0">
                  <td className="py-3 pr-4">
                    <div className="font-black text-[var(--ck-text)]">{row.eventLabel}</div>
                    <div className="text-xs text-[var(--ck-text-dim)]">
                      {row.role} · {formatDate(row.eventTime)} {formatTime(row.eventTime)}
                    </div>
                    {row.lastError && <div className="mt-1 max-w-[320px] truncate text-xs text-[#FCA5A5]">{row.lastError}</div>}
                  </td>
                  <td className="py-3 pr-4">
                    {row.leadId ? (
                      <Link href={`/leads/${row.leadId}`} className="font-bold text-[var(--ck-text)] hover:text-[#FCA5A5]">
                        {row.leadName}
                      </Link>
                    ) : (
                      <span className="font-bold text-[var(--ck-text-muted)]">{row.leadName}</span>
                    )}
                    <div className="text-xs text-[var(--ck-text-dim)]">{row.leadPhone} · {row.leadAddress}</div>
                    <div className="text-xs text-[var(--ck-text-dim)]">{row.campaign}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`inline-flex rounded-lg border px-2 py-1 text-xs font-black capitalize ${deadlineStatusClass(row.deadlineStatus)}`}>
                      {deadlineLabel(row)}
                    </span>
                    <div className="mt-1 text-xs text-[var(--ck-text-dim)]">age {row.ageDays ?? '--'}d</div>
                  </td>
                  <td className="py-3 pr-4">
                    <select
                      value={selectedScore}
                      onChange={(event) => {
                        const next = Number(event.target.value) as GoogleAdsQualityScore
                        setSelectedScores((current) => ({ ...current, [row.id]: next }))
                      }}
                      className="min-w-[174px] rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-bold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                      aria-label={`Google Ads quality score for ${row.eventLabel}`}
                    >
                      {GOOGLE_ADS_QUALITY_SCALE.map((item) => (
                        <option key={item.score} value={item.score}>{scoreLabel(item.score)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      disabled={!canApprove || busyId === row.id}
                      onClick={() => approve(row)}
                      className="inline-flex min-w-[112px] items-center justify-center gap-2 rounded-lg border border-[#E32E2E] bg-[#E32E2E] px-3 py-2 text-xs font-black text-white transition-colors hover:bg-[#c92323] disabled:cursor-not-allowed disabled:border-[var(--ck-border)] disabled:bg-[var(--ck-surface-elev)] disabled:text-[var(--ck-text-dim)]"
                    >
                      <Icon name={busyId === row.id ? 'hourglass_top' : 'check_circle'} size="text-base" />
                      {busyId === row.id ? 'Saving' : 'Approve'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function QueueStat({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClasses(tone)}`}>
      <div className="text-xs font-black uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums text-[var(--ck-text)]">{formatNumber(value)}</div>
    </div>
  )
}
