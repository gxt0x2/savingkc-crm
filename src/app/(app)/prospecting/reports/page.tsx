import Link from 'next/link'
import { ProspectingCallReportView } from '@/components/prospecting/prospecting-call-report'
import { Icon } from '@/components/ui/icon'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingCampaignId } from '@/lib/prospecting/audience-handoff'
import { isProspectingDialerPickerCampaign, type ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'
import { resolveMyDayDateRange } from '@/lib/my-day-range'
import { getProspectingCallReport, prospectingCallSort, prospectingCallSortDirection, type ProspectingCallReport } from '@/lib/server/prospecting-call-report'
import { listProspectingCampaigns } from '@/lib/server/prospecting-campaigns'

export const dynamic = 'force-dynamic'

export type ProspectingReportView = 'calls' | 'sessions' | 'recordings'

function reportView(value: string | undefined): ProspectingReportView {
  return value === 'sessions' || value === 'recordings' ? value : 'calls'
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function ReportMessage({ title, message }: { title: string; message: string }) {
  return <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7">
    <div className="crm-panel mx-auto grid min-h-[28rem] max-w-4xl place-items-center rounded-2xl p-8 text-center">
      <div>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--crm-surface-subtle)] text-[var(--crm-text-dim)]"><Icon name="analytics" className="text-3xl" /></span>
        <h1 className="mt-4 text-xl font-black text-[var(--crm-ink)]">{title}</h1>
        <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--crm-text-muted)]">{message}</p>
        <Link href="/prospecting" className="crm-primary-button mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-black"><Icon name="arrow_back" />Return to Prospecting</Link>
      </div>
    </div>
  </main>
}

export default async function ProspectingReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; run?: string; page?: string; range?: string; from?: string; to?: string; agent?: string; caller?: string; q?: string; view?: string; session?: string; sort?: string; dir?: string }>
}) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return <ReportMessage title="Sign in required" message="Sign in to the CRM to view Prospecting call reports." />

  const params = await searchParams
  const now = new Date()
  const range = resolveMyDayDateRange({ preset: params.range, from: params.from, to: params.to }, now)
  const today = resolveMyDayDateRange({ preset: 'today' }, now).from
  const view = reportView(params.view)
  const sort = prospectingCallSort(params.sort)
  const direction = prospectingCallSortDirection(params.dir)
  let campaigns: ProspectingCampaignSummary[] = []
  let report: ProspectingCallReport | null = null
  let page = 1
  let reportError: string | null = null
  try {
    const campaignPage = await listProspectingCampaigns(actor, { limit: 50 })
    campaigns = campaignPage.items.filter((campaign) => campaign.kind === 'dialer' && isProspectingDialerPickerCampaign(campaign))
    const campaignId = params.campaign && params.campaign !== 'all' ? prospectingCampaignId(params.campaign) : null
    const runNumber = campaignId && params.run ? positiveInteger(params.run, 0) || null : null
    page = positiveInteger(params.page, 1)
    report = await getProspectingCallReport(actor, campaignId, {
      runNumber,
      page,
      limit: 50,
      from: range.from,
      to: range.to,
      agentEmail: params.agent,
      callerId: params.caller,
      search: params.q,
      sessionId: params.session,
      sort,
      direction,
    })
  } catch (error) {
    reportError = error instanceof Error ? error.message : 'The Prospecting call report could not be loaded.'
  }

  if (reportError) return <ReportMessage title="Report unavailable" message={reportError} />
  if (!report) return <ReportMessage title="No calling campaigns" message="Build and activate a Prospecting calling campaign before opening call reporting." />
  return <ProspectingCallReportView report={report} campaigns={campaigns} page={page} range={range} today={today} view={view} selectedSessionId={params.session || null} sort={sort} direction={direction} />
}
