'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Icon } from '@/components/ui/icon'
import type { PpcReport } from '@/lib/marketing/ppc-report'
import { GOOGLE_ADS_QUALITY_SCALE, type GoogleAdsQualityScore } from '@/lib/ppc/conversion-approval'

const PERIODS = [7, 30, 90, 180] as const

type LoadState =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: PpcReport; error: null }
  | { status: 'error'; data: null; error: string }

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

function statusLabel(status: PpcReport['recentLeads'][number]['formStatus']): string {
  if (status === 'submitted') return 'Submitted'
  if (status === 'stage_3_no_submit') return 'Step 3 only'
  if (status === 'potential_no_submit') return 'Potential'
  if (status === 'call_only') return 'Call only'
  return 'Lead only'
}

function statusClass(status: PpcReport['recentLeads'][number]['formStatus']): string {
  if (status === 'submitted') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (status === 'stage_3_no_submit') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  if (status === 'potential_no_submit') return 'border-sky-500/30 bg-sky-500/10 text-sky-300'
  if (status === 'call_only') return 'border-violet-500/30 bg-violet-500/10 text-violet-300'
  return 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]'
}

function sessionStatusClass(status: PpcReport['recentSessions'][number]['status']): string {
  if (status === 'submitted') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (status === 'step_3_no_submit') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  if (status === 'potential') return 'border-sky-500/30 bg-sky-500/10 text-sky-300'
  if (status === 'address_only' || status === 'reached_step_3') return 'border-orange-500/30 bg-orange-500/10 text-orange-300'
  if (status === 'engaged' || status === 'phone_click') return 'border-violet-500/30 bg-violet-500/10 text-violet-300'
  return 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]'
}

function journeyStepClass(status: PpcReport['journeySessions'][number]['steps'][number]['status']): string {
  if (status === 'complete') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'active') return 'border-amber-500/35 bg-amber-500/10 text-amber-200'
  return 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-dim)]'
}

function journeyStepIcon(status: PpcReport['journeySessions'][number]['steps'][number]['status']): string {
  if (status === 'complete') return 'check_circle'
  if (status === 'active') return 'pending'
  return 'radio_button_unchecked'
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
  if (row.deadlineStatus === 'critical') return `${row.daysLeft}d left`
  if (row.deadlineStatus === 'urgent') return `${row.daysLeft}d left`
  if (row.deadlineStatus === 'review') return `${row.daysLeft}d left`
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

export default function MarketingPage() {
  const [days, setDays] = useState<number>(30)
  const [refreshKey, setRefreshKey] = useState(0)
  const [approvalMessage, setApprovalMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const state = usePpcReport(days, refreshKey)
  const report = state.status === 'ready' ? state.data : null

  const maxFunnel = useMemo(() => Math.max(...(report?.funnel.map((step) => step.count) ?? [1]), 1), [report])
  const qualityScore = report
    ? Math.round((
      report.dataQuality.clickIdCoverage * 0.45 +
      report.dataQuality.attributionCoverage * 0.25 +
      Math.max(0, 100 - report.dataQuality.failedExports * 15 - report.dataQuality.pendingExports * 2) * 0.30
    ))
    : 0

  return (
    <div className="min-h-screen bg-[var(--ck-bg)] text-[var(--ck-text)]">
      <div className="mx-auto w-full max-w-[1536px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E32E2E]/15 text-[#E32E2E]">
              <Icon name="monitoring" size="text-2xl" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#E32E2E]">Search 2026</p>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Google Ads Intelligence</h1>
              <p className="mt-1 text-sm text-[var(--ck-text-muted)]">
                Final submit stays primary. Calls and step signals stay diagnostic until they prove quality.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setDays(period)}
                className={`rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                  days === period
                    ? 'border-[#E32E2E] bg-[#E32E2E] text-white'
                    : 'border-[var(--ck-border)] bg-[var(--ck-surface)] text-[var(--ck-text-muted)] hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]'
                }`}
              >
                {period}d
              </button>
            ))}
          </div>
        </header>

        {state.status === 'loading' && (
          <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-8 text-center text-sm text-[var(--ck-text-muted)]">
            Loading Google Ads intelligence...
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-lg border border-[#E32E2E]/40 bg-[#E32E2E]/10 p-5 text-sm text-[#FCA5A5]">
            {state.error}
          </div>
        )}

        {report && (
          <div className="space-y-5 pb-20">
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-7">
              <KpiCard icon="ads_click" label="Paid Visits" value={formatNumber(report.summary.paidVisits)} detail={`${formatNumber(report.summary.eventLogTotal)} logged events`} tone="info" />
              <KpiCard icon="person_add" label="PPC Leads" value={formatNumber(report.summary.totalLeads)} />
              <KpiCard icon="done_all" label="Form Submits" value={formatNumber(report.summary.formSubmits)} detail={`${formatPct(report.summary.submitRate)} submit rate`} tone="success" />
              <KpiCard icon="edit_note" label="Step 3 Only" value={formatNumber(report.summary.stage3NoSubmit)} detail="No submit yet" tone="warn" />
              <KpiCard icon="phone_in_talk" label="PPC Calls" value={formatNumber(report.summary.callLeads)} detail={`${formatNumber(report.summary.call2m)} at 2m+`} tone="info" />
              <KpiCard icon="event_available" label="Appointments" value={formatNumber(report.summary.appointments)} detail={`${formatPct(report.summary.appointmentRate)} of leads`} tone="success" />
              <KpiCard icon="payments" label="Revenue" value={formatMoney(report.summary.revenue)} detail={`${formatNumber(report.summary.contracts)} contracts`} tone="money" />
            </section>

            <Panel title="Click-to-Close Tracking Flow" icon="account_tree">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <FlowStep icon="ads_click" label="Ad Click" value="Ads UI" detail="Spend, CPC, campaign" tone="red" />
                <FlowStep icon="web_traffic" label="Visit Logged" value={formatNumber(report.summary.paidVisits)} detail="First-party event rows" tone="violet" />
                <FlowStep icon="fact_check" label="Form Signals" value={formatNumber(report.summary.optionSelections)} detail={`${formatNumber(report.summary.step2Completions)} reached Step 3`} tone="amber" />
                <FlowStep icon="person_add" label="CRM Lead" value={formatNumber(report.summary.totalLeads)} detail={`${formatNumber(report.summary.consentedSubmits)} with consent`} tone="emerald" />
                <FlowStep icon="verified" label="Ads Export" value={formatNumber(report.exportHealth.awaitingApproval)} detail="Awaiting approval" tone="slate" />
              </div>
            </Panel>

            <ApprovalQueuePanel
              report={report}
              message={approvalMessage}
              onMessage={setApprovalMessage}
              onApproved={() => setRefreshKey((value) => value + 1)}
            />

            <Panel title="Paid Click Journey" icon="conversion_path">
              <div className="space-y-3">
                {report.journeySessions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--ck-border)] p-6 text-center text-sm text-[var(--ck-text-muted)]">
                    No paid click journeys in this period.
                  </div>
                ) : report.journeySessions.map((session) => (
                  <JourneySessionCard key={session.key} session={session} />
                ))}
              </div>
            </Panel>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
              <Panel title="Submit-First Funnel" icon="filter_alt">
                <div className="space-y-3">
                  {report.funnel.map((step) => (
                    <div key={step.key} className="grid grid-cols-[140px_1fr_96px] items-center gap-3 text-sm">
                      <div>
                        <div className="font-bold text-[var(--ck-text)]">{step.label}</div>
                        <div className="text-xs text-[var(--ck-text-dim)]">
                          {step.rateFromPrevious == null ? 'Start' : `${formatPct(step.rateFromPrevious)} from prior`}
                        </div>
                      </div>
                      <div className="h-9 overflow-hidden rounded-lg bg-[var(--ck-surface-elev)]">
                        <div
                          className="flex h-full items-center justify-end rounded-lg bg-[#E32E2E] px-3 text-xs font-black text-white transition-all"
                          style={{ width: `${Math.max((step.count / maxFunnel) * 100, step.count > 0 ? 8 : 0)}%` }}
                        >
                          {step.count > 0 ? formatNumber(step.count) : ''}
                        </div>
                      </div>
                      <div className="text-right text-xs font-bold text-[var(--ck-text-muted)]">
                        {step.rateFromLead == null ? '--' : `${formatPct(step.rateFromLead)} of leads`}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Call Quality" icon="phone_in_talk">
                <div className="grid grid-cols-2 gap-3">
                  {report.callQuality.map((item) => (
                    <div key={item.key} className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
                      <div className="text-xs font-bold uppercase tracking-wide text-[var(--ck-text-dim)]">{item.label}</div>
                      <div className="mt-2 text-3xl font-black tabular-nums">{formatNumber(item.count)}</div>
                      <div className="mt-1 text-xs text-[var(--ck-text-muted)]">
                        {item.shareOfConnected == null ? 'Baseline' : `${formatPct(item.shareOfConnected)} of connected`}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </section>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[0.85fr_1.15fr]">
              <Panel title="Data Quality" icon="fact_check">
                <div className="mb-4 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-[var(--ck-text-dim)]">Setup Grade</div>
                      <div className="mt-1 text-4xl font-black">{qualityScore >= 90 ? 'A' : qualityScore >= 82 ? 'B+' : qualityScore >= 75 ? 'B' : 'C'}</div>
                    </div>
                    <div className="text-right text-sm text-[var(--ck-text-muted)]">
                      <div>{formatPct(report.dataQuality.clickIdCoverage)} click ID coverage</div>
                      <div>{formatPct(report.dataQuality.attributionCoverage)} attribution coverage</div>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <QualityRow label="Click IDs" value={report.dataQuality.clickIdCoverage} />
                  <QualityRow label="Campaign / Keyword Map" value={report.dataQuality.attributionCoverage} />
                  <QualityRow label="Source / Medium Map" value={report.dataQuality.sourceMediumCoverage} />
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                  <MiniMetric label="GCLID" value={report.dataQuality.gclidRows} />
                  <MiniMetric label="GBRAID" value={report.dataQuality.gbraidRows} />
                  <MiniMetric label="WBRAID" value={report.dataQuality.wbraidRows} />
                  <MiniMetric label="No ID" value={report.dataQuality.missingClickIdRows} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <ExportBox label="Awaiting Approval" value={report.exportHealth.awaitingApproval} tone={report.exportHealth.awaitingApproval > 0 ? 'warn' : 'ok'} />
                  <ExportBox label="Approved Pending" value={report.exportHealth.approvedPending} tone={report.exportHealth.approvedPending > 0 ? 'warn' : 'ok'} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <ExportBox label="Failed Exports" value={report.exportHealth.failed + report.exportHealth.deadLetter} tone={report.exportHealth.failed + report.exportHealth.deadLetter > 0 ? 'bad' : 'ok'} />
                  <ExportBox label="Test Records Hidden" value={report.summary.testRecords} tone={report.summary.testRecords > 0 ? 'warn' : 'ok'} />
                </div>
              </Panel>

              <Panel title="Daily Signal" icon="bar_chart">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.daily} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="var(--ck-border)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={(value) => formatDate(`${value}T12:00:00.000Z`)} tick={{ fill: 'var(--ck-text-dim)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--ck-border)' }} />
                      <YAxis allowDecimals={false} tick={{ fill: 'var(--ck-text-dim)', fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                        contentStyle={{
                          background: 'var(--ck-surface)',
                          border: '1px solid var(--ck-border)',
                          borderRadius: 8,
                          color: 'var(--ck-text)',
                        }}
                      />
                      <Bar dataKey="visits" name="Paid visits" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="leads" name="Leads" fill="#E32E2E" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="formSubmits" name="Submits" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="ppcCalls" name="Calls" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="phoneClicks" name="Phone clicks" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="appointments" name="Appointments" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </section>

            <Panel title="Campaign / Keyword Breakdown" icon="table_chart">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--ck-border)] text-left text-xs uppercase tracking-wide text-[var(--ck-text-dim)]">
                      <th className="py-3 pr-4">Campaign</th>
                      <th className="py-3 pr-4">Keyword</th>
                      <th className="py-3 pr-4 text-right">Leads</th>
                      <th className="py-3 pr-4 text-right">Submits</th>
                      <th className="py-3 pr-4 text-right">Calls</th>
                      <th className="py-3 pr-4 text-right">Appts</th>
                      <th className="py-3 pr-4 text-right">Contracts</th>
                      <th className="py-3 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.attributionRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[var(--ck-text-muted)]">No PPC attribution rows in this period.</td>
                      </tr>
                    ) : report.attributionRows.map((row) => (
                      <tr key={row.key} className="border-b border-[var(--ck-border)] last:border-b-0">
                        <td className="py-3 pr-4">
                          <div className="font-bold text-[var(--ck-text)]">{row.campaign}</div>
                          <div className="text-xs text-[var(--ck-text-dim)]">{row.source} / {row.medium} · campaign {row.campaignId}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="font-medium">{row.keyword}</div>
                          <div className="text-xs text-[var(--ck-text-dim)]">ad group {row.adGroupId}</div>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(row.leads)}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(row.formSubmits)}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(row.callLeads)}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(row.appointments)}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(row.contracts)}</td>
                        <td className="py-3 text-right font-bold tabular-nums">{formatMoney(row.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Recent Paid Click Sessions" icon="timeline">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--ck-border)] text-left text-xs uppercase tracking-wide text-[var(--ck-text-dim)]">
                      <th className="py-3 pr-4">Time</th>
                      <th className="py-3 pr-4">Journey</th>
                      <th className="py-3 pr-4">Choices</th>
                      <th className="py-3 pr-4">Campaign</th>
                      <th className="py-3 pr-4">Click ID</th>
                      <th className="py-3 text-right">CRM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.recentSessions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-[var(--ck-text-muted)]">No paid click sessions in this period.</td>
                      </tr>
                    ) : report.recentSessions.map((session) => (
                      <tr key={session.key} className="border-b border-[var(--ck-border)] last:border-b-0">
                        <td className="py-3 pr-4">
                          <div className="font-bold text-[var(--ck-text)]">{formatTime(session.firstEventAt)}</div>
                          <div className="text-xs text-[var(--ck-text-dim)]">{formatDate(session.firstEventAt)} · {session.eventCount} events</div>
                          <div className="text-xs text-[var(--ck-text-dim)]">{session.device}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex rounded-lg border px-2 py-1 text-xs font-bold ${sessionStatusClass(session.status)}`}>
                            {session.lastEvent}
                          </span>
                          <div className="mt-1 text-xs text-[var(--ck-text-dim)]">max step {session.maxStep || 1} · address {session.addressSignal}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="capitalize">{session.situation.replace(/-/g, ' ')}</div>
                          <div className="text-xs capitalize text-[var(--ck-text-dim)]">{session.timeline.replace(/-/g, ' ')} · {session.condition.replace(/-/g, ' ')}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <div>{session.campaign}</div>
                          <div className="text-xs text-[var(--ck-text-dim)]">{session.source} / {session.medium}</div>
                        </td>
                        <td className="py-3 pr-4 max-w-[180px] truncate font-mono text-xs text-[var(--ck-text-muted)]">{session.clickId}</td>
                        <td className="py-3 text-right">
                          {session.leadId ? (
                            <Link href={`/leads/${session.leadId}`} className="font-bold text-[#FCA5A5] hover:text-[#FEE2E2]">
                              Lead
                            </Link>
                          ) : (
                            <span className="text-xs text-[var(--ck-text-dim)]">No lead yet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Lead-Level Proof" icon="receipt_long">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--ck-border)] text-left text-xs uppercase tracking-wide text-[var(--ck-text-dim)]">
                      <th className="py-3 pr-4">Lead</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3 pr-4">Signal</th>
                      <th className="py-3 pr-4">Campaign</th>
                      <th className="py-3 pr-4">Click ID</th>
                      <th className="py-3 pr-4 text-right">Call</th>
                      <th className="py-3 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.recentLeads.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-[var(--ck-text-muted)]">No PPC leads in this period.</td>
                      </tr>
                    ) : report.recentLeads.map((lead) => (
                      <tr key={lead.id} className="border-b border-[var(--ck-border)] last:border-b-0">
                        <td className="py-3 pr-4">
                          <Link href={`/leads/${lead.id}`} className="font-bold text-[var(--ck-text)] hover:text-[#FCA5A5]">
                            {lead.name}
                          </Link>
                          <div className="text-xs text-[var(--ck-text-dim)]">{lead.phone} · {lead.address}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex rounded-lg border px-2 py-1 text-xs font-bold ${statusClass(lead.formStatus)}`}>
                            {statusLabel(lead.formStatus)}
                          </span>
                          <div className="mt-1 text-xs capitalize text-[var(--ck-text-dim)]">{lead.stage}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="max-w-[260px] truncate">{lead.lastSignal}</div>
                          <div className="text-xs text-[var(--ck-text-dim)]">{formatDate(lead.lastSignalAt || lead.createdAt)}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <div>{lead.campaign}</div>
                          <div className="text-xs text-[var(--ck-text-dim)]">{lead.keyword}</div>
                        </td>
                        <td className="py-3 pr-4 max-w-[180px] truncate font-mono text-xs text-[var(--ck-text-muted)]">{lead.clickId}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">{lead.callQuality}</td>
                        <td className="py-3 text-right font-bold tabular-nums">{formatMoney(lead.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )}
      </div>
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
    <Panel title="Conversion Approval Queue" icon="approval">
      <div className="mb-4 grid gap-3 xl:grid-cols-[1fr_1.2fr]">
        <div className="grid grid-cols-3 gap-2">
          <ExportBox label="Awaiting" value={report.conversionApproval.awaitingApproval} tone={report.conversionApproval.awaitingApproval > 0 ? 'warn' : 'ok'} />
          <ExportBox label="Urgent" value={report.conversionApproval.urgent + report.conversionApproval.critical} tone={report.conversionApproval.urgent + report.conversionApproval.critical > 0 ? 'bad' : 'ok'} />
          <ExportBox label="Expired" value={report.conversionApproval.expired} tone={report.conversionApproval.expired > 0 ? 'bad' : 'ok'} />
        </div>
        <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {GOOGLE_ADS_QUALITY_SCALE.map((item) => (
              <div key={item.score} className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black uppercase tracking-wide text-[var(--ck-text-dim)]">Score {item.score}</span>
                  <span className="rounded-md bg-[#E32E2E]/15 px-2 py-1 text-xs font-black text-[#FCA5A5]">{item.googleSignal}</span>
                </div>
                <div className="mt-2 text-sm font-black text-[var(--ck-text)]">{item.title}</div>
                <div className="mt-1 text-xs leading-5 text-[var(--ck-text-muted)]">{item.internalStandard}</div>
              </div>
            ))}
          </div>
        </div>
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
              <th className="py-3 pr-4">Click ID</th>
              <th className="py-3 pr-4">Google Value</th>
              <th className="py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {report.conversionApprovalQueue.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[var(--ck-text-muted)]">
                  No conversions need approval right now.
                </td>
              </tr>
            ) : report.conversionApprovalQueue.map((row) => {
              const selectedScore = selectedScores[row.id] ?? row.qualityScore ?? row.suggestedQualityScore
              const canApprove = row.status !== 'sent' && row.deadlineStatus !== 'expired'

              return (
                <tr key={row.id} className="border-b border-[var(--ck-border)] last:border-b-0">
                  <td className="py-3 pr-4">
                    <div className="font-black text-[var(--ck-text)]">{row.eventLabel}</div>
                    <div className="text-xs text-[var(--ck-text-dim)]">
                      {row.role} · {row.category} · {formatDate(row.eventTime)} {formatTime(row.eventTime)}
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
                    <div className="mt-1 text-xs text-[var(--ck-text-dim)]">
                      age {row.ageDays ?? '--'}d · expires {formatDate(row.expiresAt)}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-mono text-xs text-[var(--ck-text-muted)]">{row.clickId}</div>
                    <div className="text-xs uppercase text-[var(--ck-text-dim)]">{row.clickIdType}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <select
                      value={selectedScore}
                      onChange={(event) => {
                        const next = Number(event.target.value) as GoogleAdsQualityScore
                        setSelectedScores((current) => ({ ...current, [row.id]: next }))
                      }}
                      className="min-w-[190px] rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-bold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                      aria-label={`Google Ads quality score for ${row.eventLabel}`}
                    >
                      {GOOGLE_ADS_QUALITY_SCALE.map((item) => (
                        <option key={item.score} value={item.score}>{scoreLabel(item.score)}</option>
                      ))}
                    </select>
                    <div className="mt-1 text-xs text-[var(--ck-text-dim)]">
                      Google receives {selectedScore}; profit stays internal.
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      disabled={!canApprove || busyId === row.id}
                      onClick={() => approve(row)}
                      className="inline-flex min-w-[116px] items-center justify-center gap-2 rounded-lg border border-[#E32E2E] bg-[#E32E2E] px-3 py-2 text-xs font-black text-white transition-colors hover:bg-[#c92323] disabled:cursor-not-allowed disabled:border-[var(--ck-border)] disabled:bg-[var(--ck-surface-elev)] disabled:text-[var(--ck-text-dim)]"
                    >
                      <Icon name={busyId === row.id ? 'hourglass_top' : 'check_circle'} size="text-base" />
                      {busyId === row.id ? 'Saving' : 'Approve'}
                    </button>
                    {row.approvedAt && (
                      <div className="mt-1 text-xs text-[var(--ck-text-dim)]">approved {formatDate(row.approvedAt)}</div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function Panel({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Icon name={icon} size="text-lg" className="text-[#E32E2E]" />
        <h2 className="text-sm font-black uppercase tracking-wide text-[var(--ck-text)]">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function FlowStep({
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
  tone: 'red' | 'violet' | 'amber' | 'emerald' | 'slate'
}) {
  const toneClass = {
    red: 'border-[#E32E2E]/35 bg-[#E32E2E]/10 text-[#FCA5A5]',
    violet: 'border-violet-500/35 bg-violet-500/10 text-violet-300',
    amber: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
    emerald: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
    slate: 'border-sky-500/35 bg-sky-500/10 text-sky-300',
  }[tone]

  return (
    <div className={`relative rounded-lg border p-4 ${toneClass}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-black uppercase tracking-wide">{label}</div>
        <Icon name={icon} size="text-xl" />
      </div>
      <div className="text-2xl font-black tabular-nums text-[var(--ck-text)]">{value}</div>
      <div className="mt-1 text-xs font-medium text-[var(--ck-text-muted)]">{detail}</div>
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: string
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'success' | 'warn' | 'info' | 'money'
}) {
  const toneClass = {
    default: 'text-[#E32E2E] bg-[#E32E2E]/12',
    success: 'text-emerald-300 bg-emerald-500/12',
    warn: 'text-amber-300 bg-amber-500/12',
    info: 'text-violet-300 bg-violet-500/12',
    money: 'text-green-300 bg-green-500/12',
  }[tone]

  return (
    <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-[var(--ck-text-dim)]">{label}</div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon name={icon} size="text-lg" />
        </div>
      </div>
      <div className="text-2xl font-black tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 min-h-4 text-xs text-[var(--ck-text-muted)]">{detail ?? '\u00a0'}</div>
    </div>
  )
}

function JourneySessionCard({ session }: { session: PpcReport['journeySessions'][number] }) {
  return (
    <article className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-[#E32E2E]/30 bg-[#E32E2E]/10 px-2 py-1 text-xs font-black uppercase text-[#FCA5A5]">
              {formatTime(session.firstEventAt)}
            </span>
            <span className="text-sm font-black text-[var(--ck-text)]">{session.campaign}</span>
            <span className="text-xs text-[var(--ck-text-dim)]">{session.source} / {session.medium}</span>
            <span className="font-mono text-xs text-[var(--ck-text-dim)]">{session.clickId}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--ck-text-muted)]">
            <span>{session.eventCount} events</span>
            <span>{session.device}</span>
            <span>Situation: <b className="capitalize text-[var(--ck-text)]">{session.choices.situation}</b></span>
            <span>Timeline: <b className="capitalize text-[var(--ck-text)]">{session.choices.timeline}</b></span>
            <span>Condition: <b className="capitalize text-[var(--ck-text)]">{session.choices.condition}</b></span>
          </div>
          {session.choices.address !== '--' && (
            <div className="mt-1 max-w-full truncate text-xs text-[var(--ck-text-dim)]">
              Address: {session.choices.address}
            </div>
          )}
        </div>
        <div className="shrink-0 text-left xl:text-right">
          {session.leadId ? (
            <Link href={`/leads/${session.leadId}`} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-200 hover:bg-emerald-500/15">
              <Icon name="person_search" size="text-base" />
              {session.leadName}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-2 text-xs font-bold text-[var(--ck-text-dim)]">
              <Icon name="person_off" size="text-base" />
              No CRM lead
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {session.steps.map((step) => (
          <div key={step.key} className={`min-h-[86px] rounded-lg border p-3 ${journeyStepClass(step.status)}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-black uppercase tracking-wide">{step.label}</div>
              <Icon name={journeyStepIcon(step.status)} size="text-base" />
            </div>
            <div className="truncate text-xs font-medium text-[var(--ck-text-muted)]">{step.detail}</div>
            <div className="mt-2 text-xs font-bold tabular-nums text-[var(--ck-text-dim)]">{formatTime(step.at)}</div>
          </div>
        ))}
      </div>
    </article>
  )
}

function QualityRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-bold text-[var(--ck-text-muted)]">{label}</span>
        <span className="font-black tabular-nums">{formatPct(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--ck-surface-elev)]">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-2">
      <div className="font-black tabular-nums text-[var(--ck-text)]">{formatNumber(value)}</div>
      <div className="mt-0.5 font-bold uppercase tracking-wide text-[var(--ck-text-dim)]">{label}</div>
    </div>
  )
}

function ExportBox({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'bad' }) {
  const classes = tone === 'ok'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : tone === 'warn'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : 'border-[#E32E2E]/40 bg-[#E32E2E]/10 text-[#FCA5A5]'
  return (
    <div className={`rounded-lg border p-3 ${classes}`}>
      <div className="text-xs font-bold uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{formatNumber(value)}</div>
    </div>
  )
}
