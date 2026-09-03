import Link from 'next/link'
import { dispositionLabel, normalizeDisposition, PROSPECTING_DIALER_DISPOSITIONS } from '@/lib/dialer-dispositions'
import { formatPhone } from '@/lib/format'
import type { ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'
import type { ProspectingCallReport } from '@/lib/server/prospecting-call-report'
import { Icon } from '@/components/ui/icon'

const CHICAGO_DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Chicago',
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
  const minutes = Math.floor(safe / 60)
  const remainder = safe % 60
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

function reportHref(campaignId: string, runNumber: number | null, page: number) {
  const query = new URLSearchParams({ campaign: campaignId })
  if (runNumber !== null) query.set('run', String(runNumber))
  if (page > 1) query.set('page', String(page))
  return `/prospecting/reports?${query.toString()}`
}

function EmptyReport({ campaignId }: { campaignId: string }) {
  return <section className="crm-panel grid min-h-72 place-items-center rounded-2xl p-8 text-center">
    <div>
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--crm-surface-subtle)] text-[var(--crm-text-dim)]"><Icon name="phone_disabled" className="text-3xl" /></span>
      <h2 className="mt-4 text-lg font-black text-[var(--crm-ink)]">No calls recorded for this view</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--crm-text-muted)]">The report will populate from the durable attempt ledger as numbers are dialed and outcomes are saved.</p>
      <Link href={`/prospecting?campaign=${encodeURIComponent(campaignId)}`} className="crm-primary-button mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-black"><Icon name="arrow_back" />Return to campaign</Link>
    </div>
  </section>
}

export function ProspectingCallReportView({
  report,
  campaigns,
  page,
}: {
  report: ProspectingCallReport
  campaigns: Array<Pick<ProspectingCampaignSummary, 'id' | 'kind' | 'name'>>
  page: number
}) {
  const { metrics } = report
  const totalOutcomeCount = Object.values(report.outcomes).reduce((sum, value) => sum + value, 0)
  const outcomes = Object.entries(report.outcomes).sort((left, right) => right[1] - left[1])
  const reportCampaigns = campaigns.filter((campaign) => campaign.kind === 'dialer')
  const campaignOptions = reportCampaigns.some((campaign) => campaign.id === report.campaign.id)
    ? reportCampaigns
    : [{ id: report.campaign.id, kind: 'dialer' as const, name: report.campaign.name }, ...reportCampaigns]
  const previousPage = Math.max(1, page - 1)
  const nextPage = page + 1

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7">
    <div className="mx-auto max-w-[1540px] space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href={`/prospecting?campaign=${encodeURIComponent(report.campaign.id)}`} className="inline-flex items-center gap-1 text-xs font-black text-[var(--crm-brand)] hover:underline"><Icon name="arrow_back" />Back to Prospecting</Link>
          <p className="crm-eyebrow mt-4">Prospecting reports</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--crm-ink)]">Call performance</h1>
          <p className="mt-2 text-sm text-[var(--crm-text-muted)]">List, phone, agent, session, and result reporting from saved dialer attempts.</p>
        </div>
        <form action="/prospecting/reports" method="get" className="crm-panel grid gap-3 rounded-2xl p-4 sm:grid-cols-[minmax(15rem,1fr)_minmax(10rem,auto)_auto] sm:items-end">
          <label className="text-xs font-black text-[var(--crm-ink)]">Campaign
            <select name="campaign" aria-label="Report campaign" defaultValue={report.campaign.id} className="crm-field mt-1.5 h-11 w-full rounded-xl px-3 text-sm font-bold">
              {campaignOptions.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-black text-[var(--crm-ink)]">Campaign run
            <select name="run" aria-label="Campaign run" defaultValue={report.runNumber ?? ''} className="crm-field mt-1.5 h-11 w-full rounded-xl px-3 text-sm font-bold">
              <option value="">All runs</option>
              {report.runs.map((run) => <option key={run.runNumber} value={run.runNumber}>Run {run.runNumber}</option>)}
            </select>
          </label>
          <button type="submit" className="crm-primary-button h-11 rounded-xl px-5 text-sm font-black">Apply</button>
        </form>
      </div>

      <section className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#121a26_0%,#16243a_58%,#3a202b_100%)] p-5 text-white shadow-[0_24px_70px_rgba(5,13,25,0.2)] sm:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white/12 px-2.5 py-1 text-[9px] font-black uppercase">{report.campaign.status}</span>{report.runNumber ? <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/55">Run {report.runNumber}</span> : <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/55">All runs</span>}</div>
            <h2 className="mt-3 text-2xl font-black sm:text-3xl">{report.campaign.name}</h2>
          </div>
          <p className="text-xs font-bold text-white/55">Current campaign run: {report.campaign.currentRunNumber}</p>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {[
            ['phone_in_talk', metrics.attempts, 'Attempts'],
            ['phone_in_talk', metrics.uniqueNumbers, 'Numbers'],
            ['phone_callback', metrics.providerConnected, 'Connected'],
            ['record_voice_over', metrics.reached, 'Reached person'],
            ['fact_check', metrics.resultsSaved, 'Results saved'],
            ['analytics', `${rate(metrics.reached, metrics.attempts)}%`, 'Reach rate'],
            ['schedule', duration(metrics.durationSeconds), 'Call time'],
            ['groups', metrics.agents, 'Agents'],
          ].map(([icon, value, label]) => <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/6 p-3"><Icon name={String(icon)} className="text-xl text-white/45" /><p className="mt-3 text-xl font-black">{value}</p><p className="mt-1 text-[9px] font-black uppercase tracking-wider text-white/50">{label}</p></div>)}
        </div>
      </section>

      {metrics.attempts === 0 ? <EmptyReport campaignId={report.campaign.id} /> : <>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
          <section className="crm-panel rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4"><div><p className="crm-eyebrow">Call results</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Disposition breakdown</h2></div><span className="text-xs font-black text-[var(--crm-text-muted)]">{totalOutcomeCount} saved</span></div>
            {outcomes.length > 0 ? <div className="mt-5 space-y-3">{outcomes.map(([outcome, value]) => <div key={outcome}>
              <div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-[var(--crm-ink)]">{resultLabel('dispositioned', outcome)}</span><span className="font-black text-[var(--crm-text-muted)]">{value} · {rate(value, totalOutcomeCount)}%</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--crm-surface-subtle)]"><div className="h-full rounded-full bg-[var(--crm-brand)]" style={{ width: `${rate(value, totalOutcomeCount)}%` }} /></div>
            </div>)}</div> : <p className="mt-5 text-sm text-[var(--crm-text-muted)]">No final outcomes have been saved in this view.</p>}
          </section>

          <section className="crm-panel rounded-2xl p-5 sm:p-6">
            <p className="crm-eyebrow">Agent results</p>
            <h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Calling team</h2>
            <div className="mt-4 space-y-3">{report.agents.map((agent) => <div key={agent.email} className="rounded-xl bg-[var(--crm-surface-subtle)] p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-black text-[var(--crm-ink)]">{agent.name}</p><p className="mt-0.5 text-[10px] text-[var(--crm-text-muted)]">{agent.email}</p></div><span className="rounded-full bg-[var(--crm-surface)] px-2.5 py-1 text-[10px] font-black text-[var(--crm-text-muted)]">{agent.sessions} session{agent.sessions === 1 ? '' : 's'}</span></div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center"><div><dt className="text-[9px] font-black uppercase text-[var(--crm-text-muted)]">Results</dt><dd className="mt-1 font-black text-[var(--crm-ink)]">{agent.resultsSaved}</dd></div><div><dt className="text-[9px] font-black uppercase text-[var(--crm-text-muted)]">Reached</dt><dd className="mt-1 font-black text-[var(--crm-ink)]">{agent.reached}</dd></div><div><dt className="text-[9px] font-black uppercase text-[var(--crm-text-muted)]">Rate</dt><dd className="mt-1 font-black text-[var(--crm-ink)]">{rate(agent.reached, agent.resultsSaved)}%</dd></div></dl>
            </div>)}</div>
          </section>
        </div>

        <section className="crm-panel overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--crm-border)] p-5 sm:px-6"><p className="crm-eyebrow">Call log</p><div className="mt-1 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-black text-[var(--crm-ink)]">Every number and result</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Newest attempts first · times shown in Central Time</p></div><span className="text-xs font-black text-[var(--crm-text-muted)]">{report.attempts.pageInfo.total.toLocaleString()} attempts</span></div></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[72rem] text-left text-xs">
              <thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Called</th><th className="px-4 py-3">Seller / property</th><th className="px-4 py-3">Number</th><th className="px-4 py-3">Result</th><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Run</th><th className="px-4 py-3">Duration</th><th className="px-5 py-3">Caller ID</th></tr></thead>
              <tbody className="divide-y divide-[var(--crm-border)]">{report.attempts.items.map((attempt) => <tr key={attempt.id} className="hover:bg-[var(--crm-surface-hover)]"><td className="whitespace-nowrap px-5 py-4 font-bold text-[var(--crm-text-muted)]">{dateTime(attempt.startedAt || attempt.createdAt)}</td><td className="max-w-sm px-4 py-4"><p className="font-black text-[var(--crm-ink)]">{attempt.sellerName || 'Unknown seller'}</p><p className="mt-1 truncate text-[10px] text-[var(--crm-text-muted)]">{attempt.propertyAddress || 'Property not linked'}</p></td><td className="whitespace-nowrap px-4 py-4 font-mono font-black text-[var(--crm-ink)]">{formatPhone(attempt.phone)}</td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${resultTone(attempt.status, attempt.reached)}`}>{resultLabel(attempt.status, attempt.disposition)}</span></td><td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-ink)]">{attempt.agentName}</td><td className="px-4 py-4 font-black text-[var(--crm-text-muted)]">#{attempt.runNumber}</td><td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-text-muted)]">{duration(attempt.durationSeconds)}</td><td className="whitespace-nowrap px-5 py-4 font-mono text-[var(--crm-text-muted)]">{formatPhone(attempt.callerId)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[var(--crm-border)] p-4 sm:px-6">
            <p className="text-xs font-bold text-[var(--crm-text-muted)]">Page {page}</p>
            <div className="flex gap-2">
              {page > 1 ? <Link href={reportHref(report.campaign.id, report.runNumber, previousPage)} className="crm-secondary-button inline-flex min-h-10 items-center gap-1 rounded-xl px-4 text-xs font-black"><Icon name="chevron_left" />Previous</Link> : <span className="crm-secondary-button inline-flex min-h-10 cursor-not-allowed items-center gap-1 rounded-xl px-4 text-xs font-black opacity-40"><Icon name="chevron_left" />Previous</span>}
              {report.attempts.pageInfo.hasMore ? <Link href={reportHref(report.campaign.id, report.runNumber, nextPage)} className="crm-secondary-button inline-flex min-h-10 items-center gap-1 rounded-xl px-4 text-xs font-black">Next<Icon name="chevron_right" /></Link> : <span className="crm-secondary-button inline-flex min-h-10 cursor-not-allowed items-center gap-1 rounded-xl px-4 text-xs font-black opacity-40">Next<Icon name="chevron_right" /></span>}
            </div>
          </div>
        </section>

        <section className="crm-panel overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--crm-border)] p-5 sm:px-6"><p className="crm-eyebrow">Session history</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">List batches and progress</h2></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[52rem] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Started</th><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Run</th><th className="px-4 py-3">Queue</th><th className="px-4 py-3">Results</th><th className="px-4 py-3">Reached</th><th className="px-4 py-3">Skipped</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.sessions.map((session) => <tr key={session.id}><td className="whitespace-nowrap px-5 py-4 font-bold text-[var(--crm-text-muted)]">{dateTime(session.startedAt)}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.agentName}</td><td className="px-4 py-4 font-black text-[var(--crm-text-muted)]">#{session.runNumber}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.queueSize}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.resultsSaved}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.reached}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.skips}</td><td className="px-5 py-4"><span className="rounded-full bg-[var(--crm-surface-subtle)] px-2.5 py-1 text-[10px] font-black uppercase text-[var(--crm-text-muted)]">{session.status}</span></td></tr>)}</tbody></table></div>
        </section>
      </>}
    </div>
  </main>
}
