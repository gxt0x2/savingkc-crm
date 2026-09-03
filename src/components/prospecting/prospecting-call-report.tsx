import { Fragment } from 'react'
import Link from 'next/link'
import { ProspectingReportFilters } from '@/components/prospecting/prospecting-report-filters'
import { ProspectingSectionNav } from '@/components/prospecting/prospecting-section-nav'
import { Icon } from '@/components/ui/icon'
import { dispositionLabel, normalizeDisposition, PROSPECTING_DIALER_DISPOSITIONS } from '@/lib/dialer-dispositions'
import { formatPhone } from '@/lib/format'
import type { MyDayDateRange } from '@/lib/my-day-range'
import type { ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'
import type { ProspectingCallReport, ProspectingCallReportAttempt } from '@/lib/server/prospecting-call-report'

type ReportView = 'calls' | 'sessions' | 'recordings'

const CHICAGO_DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
})
const PROSPECTING_RESULT_LABELS = new Map(PROSPECTING_DIALER_DISPOSITIONS.map((item) => [item.id, item.label]))

function dateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : CHICAGO_DATE_TIME.format(date)
}

function duration(seconds: number | null) {
  if (seconds == null) return '—'
  const safe = Math.max(0, Math.round(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remainder = safe % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function rate(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function resultLabel(status: string, disposition: string | null) {
  if (disposition) {
    const normalized = normalizeDisposition(disposition)
    return (normalized && PROSPECTING_RESULT_LABELS.get(normalized)) || dispositionLabel(disposition)
  }
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'awaiting_disposition') return 'Outcome required'
  if (status === 'connected') return 'Connected'
  if (status === 'dialing') return 'Dialing'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function resultTone(status: string, reached: boolean | null) {
  if (reached) return 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
  if (status === 'failed' || status === 'cancelled') return 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'
  if (status === 'awaiting_disposition') return 'bg-amber-100 text-amber-800'
  return 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'
}

function reportHref({ report, range, view, page, query, sessionId }: {
  report: ProspectingCallReport
  range: MyDayDateRange
  view: ReportView
  page?: number
  query?: string | null
  sessionId?: string | null
}) {
  const params = new URLSearchParams({ campaign: report.campaign.id || 'all', range: range.preset })
  if (report.runNumber !== null) params.set('run', String(report.runNumber))
  if (range.preset === 'custom') { params.set('from', range.from); params.set('to', range.to) }
  if (report.filters.agentEmail) params.set('agent', report.filters.agentEmail)
  if (report.filters.callerId) params.set('caller', report.filters.callerId)
  if (view !== 'calls') params.set('view', view)
  if (view === 'calls' && query) params.set('q', query)
  if (view === 'sessions' && sessionId) params.set('session', sessionId)
  if (view === 'calls' && page && page > 1) params.set('page', String(page))
  return `/prospecting/reports?${params.toString()}`
}

function HiddenReportFields({ report, range, view }: { report: ProspectingCallReport; range: MyDayDateRange; view: ReportView }) {
  return <>
    <input type="hidden" name="campaign" value={report.campaign.id || 'all'} />
    <input type="hidden" name="range" value={range.preset} />
    {report.runNumber !== null ? <input type="hidden" name="run" value={report.runNumber} /> : null}
    {range.preset === 'custom' ? <><input type="hidden" name="from" value={range.from} /><input type="hidden" name="to" value={range.to} /></> : null}
    {report.filters.agentEmail ? <input type="hidden" name="agent" value={report.filters.agentEmail} /> : null}
    {report.filters.callerId ? <input type="hidden" name="caller" value={report.filters.callerId} /> : null}
    {view !== 'calls' ? <input type="hidden" name="view" value={view} /> : null}
  </>
}

function EmptyReport({ campaignId }: { campaignId: string | null }) {
  return <section className="crm-panel grid min-h-72 place-items-center rounded-2xl p-8 text-center"><div>
    <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--crm-surface-subtle)] text-[var(--crm-text-dim)]"><Icon name="phone_disabled" className="text-3xl" /></span>
    <h2 className="mt-4 text-lg font-black text-[var(--crm-ink)]">No calls recorded for this view</h2>
    <p className="mt-2 max-w-md text-sm leading-6 text-[var(--crm-text-muted)]">The report will populate from the durable attempt ledger as numbers are dialed and outcomes are saved.</p>
    <Link href={campaignId ? `/prospecting?campaign=${encodeURIComponent(campaignId)}` : '/prospecting'} className="crm-primary-button mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-black"><Icon name="arrow_back" />Return to campaigns</Link>
  </div></section>
}

function CallRows({ attempts, showCampaign }: { attempts: ProspectingCallReportAttempt[]; showCampaign: boolean }) {
  return <>{attempts.map((attempt) => <tr key={attempt.id} className="hover:bg-[var(--crm-surface-hover)]">
    <td className="whitespace-nowrap px-5 py-4 font-bold text-[var(--crm-text-muted)]">{dateTime(attempt.startedAt || attempt.createdAt)}</td>
    {showCampaign ? <td className="max-w-56 px-4 py-4 font-black text-[var(--crm-ink)]">{attempt.campaignName}</td> : null}
    <td className="max-w-sm px-4 py-4"><p className="font-black text-[var(--crm-ink)]">{attempt.sellerName || 'Unknown seller'}</p><p className="mt-1 truncate text-[10px] text-[var(--crm-text-muted)]">{attempt.propertyAddress || 'Property not linked'}</p></td>
    <td className="whitespace-nowrap px-4 py-4 font-mono font-black text-[var(--crm-ink)]">{formatPhone(attempt.phone)}</td>
    <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${resultTone(attempt.status, attempt.reached)}`}>{resultLabel(attempt.status, attempt.disposition)}</span></td>
    <td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-ink)]">{attempt.agentName}</td>
    <td className="px-4 py-4 font-black text-[var(--crm-text-muted)]">#{attempt.runNumber}</td>
    <td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-text-muted)]">{duration(attempt.durationSeconds)}</td>
    <td className="whitespace-nowrap px-5 py-4 font-mono text-[var(--crm-text-muted)]">{formatPhone(attempt.callerId)}</td>
  </tr>)}</>
}

export function ProspectingCallReportView({ report, campaigns, page, range, today, view, selectedSessionId }: {
  report: ProspectingCallReport
  campaigns: Array<Pick<ProspectingCampaignSummary, 'id' | 'kind' | 'name'>>
  page: number
  range: MyDayDateRange
  today: string
  view: ReportView
  selectedSessionId: string | null
}) {
  const { metrics } = report
  const totalOutcomeCount = Object.values(report.outcomes).reduce((sum, value) => sum + value, 0)
  const outcomes = Object.entries(report.outcomes).sort((left, right) => right[1] - left[1])
  const reportCampaigns = campaigns.filter((campaign) => campaign.kind === 'dialer')
  const campaignOptions = report.campaign.id && !reportCampaigns.some((campaign) => campaign.id === report.campaign.id)
    ? [{ id: report.campaign.id, kind: 'dialer' as const, name: report.campaign.name }, ...reportCampaigns]
    : reportCampaigns
  const query = report.filters.search || ''

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7"><div className="mx-auto max-w-[1540px] space-y-5">
    <ProspectingSectionNav current="reports" />
    <div className="flex flex-col gap-4"><div>
      <p className="crm-eyebrow">Prospecting reports</p>
      <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--crm-ink)]">Call performance</h1>
      <p className="mt-2 text-sm text-[var(--crm-text-muted)]">List, phone, agent, session, result, and recording reporting from saved dialer attempts.</p>
    </div>
      <ProspectingReportFilters
        key={`${report.campaign.id || 'all'}:${report.runNumber || 'all'}:${report.filters.agentEmail || 'all'}:${report.filters.callerId || 'all'}:${range.preset}:${range.from}:${range.to}`}
        campaigns={campaignOptions} campaignId={report.campaign.id} runNumber={report.runNumber} runs={report.runs}
        agents={report.filters.agents} callerIds={report.filters.callerIds} agentEmail={report.filters.agentEmail} callerId={report.filters.callerId}
        range={range} today={today} view={view}
      />
    </div>

    <section className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#121a26_0%,#16243a_58%,#3a202b_100%)] p-5 text-white shadow-[0_24px_70px_rgba(5,13,25,0.2)] sm:p-7">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div>
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white/12 px-2.5 py-1 text-[9px] font-black uppercase">{range.label}</span>{report.runNumber ? <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/55">Run {report.runNumber}</span> : <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/55">All runs</span>}</div>
        <h2 className="mt-3 text-2xl font-black sm:text-3xl">{report.campaign.name}</h2>
      </div>{report.campaign.currentRunNumber ? <p className="text-xs font-bold text-white/55">Current campaign run: {report.campaign.currentRunNumber}</p> : <p className="text-xs font-bold text-white/55">{range.from === range.to ? range.from : `${range.from} through ${range.to}`}</p>}</div>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">{[
        ['phone_in_talk', metrics.attempts, 'Attempts'], ['person', metrics.uniqueNumbers, 'Numbers'], ['phone_callback', metrics.providerConnected, 'Connected'], ['record_voice_over', metrics.reached, 'Reached person'], ['fact_check', metrics.resultsSaved, 'Results saved'], ['analytics', `${rate(metrics.reached, metrics.uniqueNumbers)}%`, 'Contact rate'], ['schedule', duration(metrics.durationSeconds), 'Call time'], ['groups', metrics.agents, 'Agents'],
      ].map(([icon, value, label]) => <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/6 p-3"><Icon name={String(icon)} className="text-xl text-white/45" /><p className="mt-3 text-xl font-black">{value}</p><p className="mt-1 text-[9px] font-black uppercase tracking-wider text-white/50">{label}</p></div>)}</div>
      <p className="mt-3 text-[10px] font-semibold text-white/45">Contact rate = reached people ÷ unique numbers called.</p>
    </section>

    {metrics.attempts === 0 ? <EmptyReport campaignId={report.campaign.id} /> : <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <section className="crm-panel rounded-2xl p-5 sm:p-6"><div className="flex items-center justify-between gap-4"><div><p className="crm-eyebrow">Call results</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Disposition breakdown</h2></div><span className="text-xs font-black text-[var(--crm-text-muted)]">{totalOutcomeCount} saved</span></div>
          {outcomes.length > 0 ? <div className="mt-5 space-y-3">{outcomes.map(([outcome, value]) => <div key={outcome}><div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-[var(--crm-ink)]">{resultLabel('dispositioned', outcome)}</span><span className="font-black text-[var(--crm-text-muted)]">{value} · {rate(value, totalOutcomeCount)}%</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--crm-surface-subtle)]"><div className="h-full rounded-full bg-[var(--crm-brand)]" style={{ width: `${rate(value, totalOutcomeCount)}%` }} /></div></div>)}</div> : <p className="mt-5 text-sm text-[var(--crm-text-muted)]">No final outcomes have been saved in this view.</p>}
        </section>
        <section className="crm-panel rounded-2xl p-5 sm:p-6"><p className="crm-eyebrow">Agent results</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Calling team</h2><div className="mt-4 space-y-3">{report.agents.map((agent) => <div key={agent.email} className="rounded-xl bg-[var(--crm-surface-subtle)] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-[var(--crm-ink)]">{agent.name}</p><p className="mt-0.5 text-[10px] text-[var(--crm-text-muted)]">{agent.email}</p></div><span className="rounded-full bg-[var(--crm-surface)] px-2.5 py-1 text-[10px] font-black text-[var(--crm-text-muted)]">{agent.sessions} session{agent.sessions === 1 ? '' : 's'}</span></div><dl className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="Results" value={agent.resultsSaved} /><Metric label="Reached" value={agent.reached} /><Metric label="Reached/results" value={`${rate(agent.reached, agent.resultsSaved)}%`} /></dl></div>)}</div></section>
      </div>

      <section className="crm-panel overflow-hidden rounded-2xl">
        <nav aria-label="Call report views" className="flex flex-wrap items-center gap-1 border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-2">{([
          ['calls', `Call Detail (${report.attempts.pageInfo.total})`], ['sessions', `Sessions (${metrics.sessions})`], ['recordings', `Recordings (${report.recordings.total})`],
        ] as Array<[ReportView, string]>).map(([tab, label]) => <Link key={tab} href={reportHref({ report, range, view: tab })} aria-current={view === tab ? 'page' : undefined} className={`rounded-xl px-4 py-2.5 text-xs font-black transition ${view === tab ? 'bg-[var(--crm-brand)] text-white shadow-sm' : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface)] hover:text-[var(--crm-ink)]'}`}>{label}</Link>)}</nav>
        {view === 'calls' ? <CallDetail report={report} range={range} page={page} query={query} /> : null}
        {view === 'sessions' ? <Sessions report={report} range={range} selectedSessionId={selectedSessionId} /> : null}
        {view === 'recordings' ? <Recordings report={report} /> : null}
      </section>
    </>}
  </div></main>
}

function CallDetail({ report, range, page, query }: { report: ProspectingCallReport; range: MyDayDateRange; page: number; query: string }) {
  return <>
    <div className="flex flex-col gap-3 border-b border-[var(--crm-border)] p-5 sm:flex-row sm:items-end sm:justify-between sm:px-6"><div><p className="crm-eyebrow">Call detail</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Every number and result</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Newest attempts first · times shown in Central Time</p></div><form action="/prospecting/reports" className="flex w-full max-w-md gap-2"><HiddenReportFields report={report} range={range} view="calls" /><label className="sr-only" htmlFor="prospecting-call-search">Search call details</label><input id="prospecting-call-search" name="q" defaultValue={query} placeholder="Search seller, property, phone, result…" className="crm-field h-11 min-w-0 flex-1 rounded-xl px-3 text-sm" /><button type="submit" className="crm-secondary-button inline-flex h-11 items-center gap-2 rounded-xl px-4 text-xs font-black"><Icon name="search" className="text-[18px]" />Search</button></form></div>
    {report.attempts.items.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[72rem] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Called</th>{report.campaign.id === null ? <th className="px-4 py-3">Campaign</th> : null}<th className="px-4 py-3">Seller / property</th><th className="px-4 py-3">Number</th><th className="px-4 py-3">Result</th><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Run</th><th className="px-4 py-3">Duration</th><th className="px-5 py-3">Caller ID</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]"><CallRows attempts={report.attempts.items} showCampaign={report.campaign.id === null} /></tbody></table></div> : <div className="grid min-h-48 place-items-center p-8 text-center"><div><Icon name="search_off" className="text-3xl text-[var(--crm-text-dim)]" /><h3 className="mt-2 font-black text-[var(--crm-ink)]">No matching calls</h3><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Clear the search or adjust the report filters.</p></div></div>}
    <div className="flex items-center justify-between gap-3 border-t border-[var(--crm-border)] p-4 sm:px-6"><p className="text-xs font-bold text-[var(--crm-text-muted)]">Page {page}</p><div className="flex gap-2">{page > 1 ? <Link href={reportHref({ report, range, view: 'calls', page: page - 1, query })} className="crm-secondary-button inline-flex min-h-10 items-center gap-1 rounded-xl px-4 text-xs font-black"><Icon name="chevron_left" />Previous</Link> : <span className="crm-secondary-button inline-flex min-h-10 cursor-not-allowed items-center gap-1 rounded-xl px-4 text-xs font-black opacity-40"><Icon name="chevron_left" />Previous</span>}{report.attempts.pageInfo.hasMore ? <Link href={reportHref({ report, range, view: 'calls', page: page + 1, query })} className="crm-secondary-button inline-flex min-h-10 items-center gap-1 rounded-xl px-4 text-xs font-black">Next<Icon name="chevron_right" /></Link> : <span className="crm-secondary-button inline-flex min-h-10 cursor-not-allowed items-center gap-1 rounded-xl px-4 text-xs font-black opacity-40">Next<Icon name="chevron_right" /></span>}</div></div>
  </>
}

function Sessions({ report, range, selectedSessionId }: { report: ProspectingCallReport; range: MyDayDateRange; selectedSessionId: string | null }) {
  return <><div className="border-b border-[var(--crm-border)] p-5 sm:px-6"><p className="crm-eyebrow">Session history</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">List batches and performance</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Open a session to reconcile its calls, outcomes, and timing.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[76rem] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Started</th>{report.campaign.id === null ? <th className="px-4 py-3">Campaign</th> : null}<th className="px-4 py-3">Agent</th><th className="px-4 py-3">Run</th><th className="px-4 py-3">Calls</th><th className="px-4 py-3">Numbers</th><th className="px-4 py-3">Results</th><th className="px-4 py-3">Reached</th><th className="px-4 py-3">Call time</th><th className="px-4 py-3">Session time</th><th className="px-4 py-3">Status</th><th className="px-5 py-3"><span className="sr-only">Details</span></th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.sessions.map((session) => {
    const open = selectedSessionId === session.id
    return <Fragment key={session.id}><tr className={open ? 'bg-[var(--crm-brand-soft)]' : undefined}><td className="whitespace-nowrap px-5 py-4 font-bold text-[var(--crm-text-muted)]">{dateTime(session.startedAt)}</td>{report.campaign.id === null ? <td className="max-w-56 px-4 py-4 font-black text-[var(--crm-ink)]">{session.campaignName}</td> : null}<td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.agentName}</td><td className="px-4 py-4 font-black text-[var(--crm-text-muted)]">#{session.runNumber}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.calls}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.uniqueNumbers}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.resultsSaved}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.reached}</td><td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-text-muted)]">{duration(session.durationSeconds)}</td><td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-text-muted)]">{duration(session.sessionDurationSeconds)}</td><td className="px-4 py-4"><span className="rounded-full bg-[var(--crm-surface-subtle)] px-2.5 py-1 text-[10px] font-black uppercase text-[var(--crm-text-muted)]">{session.status}</span></td><td className="px-5 py-4"><Link href={reportHref({ report, range, view: 'sessions', sessionId: open ? null : session.id })} className="font-black text-[var(--crm-brand)]">{open ? 'Hide' : 'View details'}</Link></td></tr>{open ? <tr><td colSpan={report.campaign.id === null ? 12 : 11} className="bg-[var(--crm-surface-subtle)] p-5"><SessionDetails session={session} calls={report.selectedSessionCalls} /></td></tr> : null}</Fragment>
  })}</tbody></table></div></>
}

function SessionDetails({ session, calls }: { session: ProspectingCallReport['sessions'][number]; calls: ProspectingCallReportAttempt[] }) {
  const outcomes = Object.entries(session.outcomes).sort((left, right) => right[1] - left[1])
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]"><div><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="crm-eyebrow">Calls in this session</p><h3 className="mt-1 font-black text-[var(--crm-ink)]">{calls.length} loaded call{calls.length === 1 ? '' : 's'}</h3></div><span className="text-[10px] font-bold text-[var(--crm-text-muted)]">Up to 100 newest calls</span></div><div className="mt-3 max-h-[30rem] overflow-auto rounded-xl border border-[var(--crm-border)]"><table className="w-full min-w-[42rem] text-left text-xs"><thead className="sticky top-0 bg-[var(--crm-surface)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-4 py-3">Called</th><th className="px-4 py-3">Seller</th><th className="px-4 py-3">Number</th><th className="px-4 py-3">Result</th><th className="px-4 py-3">Duration</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{calls.map((call) => <tr key={call.id}><td className="whitespace-nowrap px-4 py-3 text-[var(--crm-text-muted)]">{dateTime(call.startedAt || call.createdAt)}</td><td className="max-w-52 px-4 py-3 font-black text-[var(--crm-ink)]">{call.sellerName || 'Unknown seller'}</td><td className="whitespace-nowrap px-4 py-3 font-mono text-[var(--crm-ink)]">{formatPhone(call.phone)}</td><td className="px-4 py-3 font-bold text-[var(--crm-ink)]">{resultLabel(call.status, call.disposition)}</td><td className="whitespace-nowrap px-4 py-3 text-[var(--crm-text-muted)]">{duration(call.durationSeconds)}</td></tr>)}</tbody></table></div></div><aside className="space-y-4"><div className="rounded-xl bg-[var(--crm-surface)] p-4"><p className="crm-eyebrow">Session timing</p><dl className="mt-3 grid grid-cols-2 gap-3"><Metric label="Calls" value={session.calls} /><Metric label="Numbers" value={session.uniqueNumbers} /><Metric label="Connected" value={session.connected} /><Metric label="Reached" value={session.reached} /><Metric label="Call time" value={duration(session.durationSeconds)} /><Metric label="Session time" value={duration(session.sessionDurationSeconds)} /></dl></div><div className="rounded-xl bg-[var(--crm-surface)] p-4"><p className="crm-eyebrow">Session results</p>{outcomes.length > 0 ? <div className="mt-3 space-y-2">{outcomes.map(([outcome, count]) => <div key={outcome} className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-[var(--crm-ink)]">{resultLabel('dispositioned', outcome)}</span><strong className="text-[var(--crm-text-muted)]">{count}</strong></div>)}</div> : <p className="mt-3 text-xs text-[var(--crm-text-muted)]">No final outcomes saved.</p>}</div></aside></div>
}

function Recordings({ report }: { report: ProspectingCallReport }) {
  return <><div className="border-b border-[var(--crm-border)] p-5 sm:px-6"><p className="crm-eyebrow">Call recordings</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Recorded prospecting conversations</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Playback stays inside the authenticated CRM; Twilio credentials are never sent to the browser.</p></div>{report.recordings.items.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[66rem] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Play</th><th className="px-4 py-3">Called</th><th className="px-4 py-3">Seller / property</th><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Result</th><th className="px-5 py-3">Campaign</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.recordings.items.map((attempt) => <tr key={attempt.id}><td className="min-w-64 px-5 py-3"><audio controls preload="metadata" src={`/api/recordings/${encodeURIComponent(attempt.recordingSid || '')}`} className="h-9 w-60" /></td><td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-text-muted)]">{dateTime(attempt.startedAt || attempt.createdAt)}</td><td className="max-w-sm px-4 py-4"><p className="font-black text-[var(--crm-ink)]">{attempt.sellerName || 'Unknown seller'}</p><p className="mt-1 truncate text-[10px] text-[var(--crm-text-muted)]">{attempt.propertyAddress || formatPhone(attempt.phone)}</p></td><td className="px-4 py-4 font-bold text-[var(--crm-ink)]">{attempt.agentName}</td><td className="px-4 py-4 font-bold text-[var(--crm-text-muted)]">{duration(attempt.durationSeconds)}</td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${resultTone(attempt.status, attempt.reached)}`}>{resultLabel(attempt.status, attempt.disposition)}</span></td><td className="max-w-56 px-5 py-4 font-black text-[var(--crm-ink)]">{attempt.campaignName}</td></tr>)}</tbody></table></div> : <div className="grid min-h-56 place-items-center p-8 text-center"><div><Icon name="mic_off" className="text-3xl text-[var(--crm-text-dim)]" /><h3 className="mt-2 font-black text-[var(--crm-ink)]">No recordings in this view</h3><p className="mt-1 max-w-md text-xs leading-5 text-[var(--crm-text-muted)]">Only completed Twilio recordings linked to durable Prospecting attempts appear here.</p></div></div>}</>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><dt className="text-[9px] font-black uppercase tracking-wide text-[var(--crm-text-muted)]">{label}</dt><dd className="mt-1 text-sm font-black text-[var(--crm-ink)]">{value}</dd></div>
}
