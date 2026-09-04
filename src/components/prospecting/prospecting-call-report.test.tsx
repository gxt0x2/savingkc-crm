/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'
import type { ProspectingCallReport } from '@/lib/server/prospecting-call-report'
import { ProspectingCallReportView } from './prospecting-call-report'

vi.mock('next/link', () => ({
  default: ({ href, children, className, scroll, 'aria-current': ariaCurrent, 'aria-label': ariaLabel }: { href: string; children: React.ReactNode; className?: string; scroll?: boolean; 'aria-current'?: 'page'; 'aria-label'?: string }) => <a href={href} className={className} data-scroll={scroll === false ? 'preserve' : undefined} aria-current={ariaCurrent} aria-label={ariaLabel}>{children}</a>,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const campaign: ProspectingCampaignSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Jackson · Tax 3+ · Sep 2',
  kind: 'dialer',
  status: 'completed',
  ownerEmail: 'ernest@savingkc.com',
  ownerName: 'Ernest',
  callerId: '+18163100845',
  fromPhone: null,
  defaultTimezone: 'America/Chicago',
  sendWindowStart: '09:00',
  sendWindowEnd: '19:00',
  sendDays: [1, 2, 3, 4, 5, 6],
  perHour: 75,
  perDay: 500,
  createdAt: '2026-09-02T17:00:00.000Z',
  updatedAt: '2026-09-02T19:00:00.000Z',
  activatedAt: '2026-09-02T17:00:00.000Z',
  pausedAt: null,
  completedAt: '2026-09-02T19:00:00.000Z',
}

const report: ProspectingCallReport = {
  campaign: { id: campaign.id, name: campaign.name, status: 'completed', currentRunNumber: 1 },
  runNumber: null,
  filters: {
    agentEmail: null,
    callerId: null,
    search: null,
    agents: [{ email: 'casey@savingkc.com', name: 'Casey' }],
    callerIds: ['+18163100845'],
  },
  metrics: { sessions: 1, agents: 1, attempts: 3, providerConnected: 2, reached: 1, resultsSaved: 2, failed: 1, uniqueNumbers: 3, durationSeconds: 88, skips: 0 },
  outcomes: { spoke_with_owner: 1, no_answer: 1 },
  runs: [{ runNumber: 1, sessions: 1, resultsSaved: 2, reached: 1, skips: 0, startedAt: '2026-09-02T18:00:00.000Z', lastActivityAt: '2026-09-02T19:00:00.000Z' }],
  agents: [{ email: 'casey@savingkc.com', name: 'Casey', sessions: 1, resultsSaved: 2, reached: 1, skips: 0 }],
  sessions: [{ id: '22222222-2222-4222-8222-222222222222', campaignId: campaign.id, campaignName: campaign.name, runNumber: 1, agentName: 'Casey', agentEmail: 'casey@savingkc.com', status: 'completed', queueSize: 3, calls: 3, connected: 2, uniqueNumbers: 3, resultsSaved: 2, reached: 1, skips: 0, durationSeconds: 88, sessionDurationSeconds: 3600, outcomes: { spoke_with_owner: 1, no_answer: 1 }, startedAt: '2026-09-02T18:00:00.000Z', endedAt: '2026-09-02T19:00:00.000Z', updatedAt: '2026-09-02T19:00:00.000Z' }],
  attempts: {
    items: [
      { id: '33333333-3333-4333-8333-333333333333', sessionId: '22222222-2222-4222-8222-222222222222', campaignId: campaign.id, campaignName: campaign.name, runNumber: 1, agentName: 'Casey', agentEmail: 'casey@savingkc.com', sellerName: 'Helen Seller', propertyAddress: '123 Main St', phone: '+18165550123', callerId: '+18163100845', status: 'dispositioned', disposition: 'spoke_with_owner', reached: true, durationSeconds: 88, recordingSid: 'RE123', postCallStatus: 'ready', createdAt: '2026-09-02T18:01:00.000Z', startedAt: '2026-09-02T18:01:01.000Z', connectedAt: '2026-09-02T18:01:05.000Z', endedAt: '2026-09-02T18:02:29.000Z' },
      { id: '44444444-4444-4444-8444-444444444444', sessionId: '22222222-2222-4222-8222-222222222222', campaignId: campaign.id, campaignName: campaign.name, runNumber: 1, agentName: 'Casey', agentEmail: 'casey@savingkc.com', sellerName: 'Nora Seller', propertyAddress: '456 Oak St', phone: '+18165550124', callerId: '+18163100845', status: 'dispositioned', disposition: 'no_answer', reached: false, durationSeconds: 24, recordingSid: null, postCallStatus: null, createdAt: '2026-09-02T18:03:00.000Z', startedAt: '2026-09-02T18:03:01.000Z', connectedAt: null, endedAt: '2026-09-02T18:03:25.000Z' },
    ],
    pageInfo: { limit: 50, offset: 0, total: 3, hasMore: false },
  },
  selectedSessionCalls: [],
  recordings: {
    items: [{ id: '33333333-3333-4333-8333-333333333333', sessionId: '22222222-2222-4222-8222-222222222222', campaignId: campaign.id, campaignName: campaign.name, runNumber: 1, agentName: 'Casey', agentEmail: 'casey@savingkc.com', sellerName: 'Helen Seller', propertyAddress: '123 Main St', phone: '+18165550123', callerId: '+18163100845', status: 'dispositioned', disposition: 'spoke_with_owner', reached: true, durationSeconds: 88, recordingSid: 'RE123', postCallStatus: 'ready', createdAt: '2026-09-02T18:01:00.000Z', startedAt: '2026-09-02T18:01:01.000Z', connectedAt: '2026-09-02T18:01:05.000Z', endedAt: '2026-09-02T18:02:29.000Z' }],
    total: 1,
  },
}

describe('ProspectingCallReportView', () => {
  const range = { preset: 'today' as const, from: '2026-09-03', to: '2026-09-03', label: 'Today' }

  it('shows list metrics, agent results, called numbers, and dispositions', () => {
    render(<ProspectingCallReportView report={report} campaigns={[campaign]} page={1} range={range} today="2026-09-03" view="calls" selectedSessionId={null} sort="called" direction="desc" />)

    expect(screen.getByRole('heading', { name: 'Call performance' })).toBeVisible()
    expect(screen.getByRole('heading', { name: campaign.name })).toBeVisible()
    expect(screen.getAllByText('3', { selector: 'p' }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('(816) 555-0123')).toBeVisible()
    expect(screen.getAllByText('Reached Person').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Casey').length).toBeGreaterThan(0)
    expect(screen.getByRole('combobox', { name: 'Report campaign' })).toHaveDisplayValue(campaign.name)
    expect(screen.getByRole('combobox', { name: 'Report agent' })).toHaveDisplayValue('All agents')
    expect(screen.getByRole('combobox', { name: 'Report caller ID' })).toHaveDisplayValue('All caller IDs')
    expect(screen.getByRole('navigation', { name: 'Prospecting sections' })).toHaveTextContent('Campaigns|Call Reports')
    expect(screen.getByRole('navigation', { name: 'Call report views' })).toHaveTextContent('Call Detail (3)Sessions (1)Recordings (1)')
    expect(screen.getByRole('link', { name: 'Sessions (1)' })).toHaveAttribute('data-scroll', 'preserve')
    expect(screen.getByText('Call details').closest('details')).toHaveAttribute('open')
    expect(screen.getByText('Hide')).toBeVisible()
    expect(screen.getByText('Contact rate')).toBeVisible()
    const rangeButton = screen.getByRole('button', { name: 'Date range: Today' })
    const searchButton = screen.getByRole('button', { name: 'Search' })
    expect(rangeButton).toBeVisible()
    expect(rangeButton.querySelector('.material-symbols-outlined')).toBeNull()
    expect(searchButton.querySelector('.material-symbols-outlined')).toBeNull()
    expect(screen.getByRole('columnheader', { name: /Called/ })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('link', { name: /Sort by Result/ })).toHaveAttribute('href', expect.stringContaining('sort=result&dir=asc'))
    expect(screen.getByRole('link', { name: /Sort by Result/ })).toHaveClass('w-full')
    expect(screen.getByRole('columnheader', { name: /Result/ })).toHaveAttribute('data-sort-control', 'result')
    expect(screen.getAllByRole('columnheader').filter((header) => header.hasAttribute('aria-sort'))).toHaveLength(8)
    expect(screen.getAllByText('Reached Person').find((element) => element.classList.contains('rounded-full'))).toHaveClass('bg-emerald-100')
    expect(screen.getAllByText('No Answer').find((element) => element.classList.contains('rounded-full'))).toHaveClass('bg-[#d9dee6]')
  })

  it('links back to the selected campaign and keeps paging filters scoped', () => {
    const nextReport = { ...report, runNumber: 1, attempts: { ...report.attempts, pageInfo: { ...report.attempts.pageInfo, hasMore: true } } }
    render(<ProspectingCallReportView report={nextReport} campaigns={[campaign]} page={1} range={range} today="2026-09-03" view="calls" selectedSessionId={null} sort="called" direction="desc" />)

    expect(screen.getByRole('link', { name: 'Campaigns' })).toHaveAttribute('href', '/prospecting')
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute('href', `/prospecting/reports?campaign=${campaign.id}&range=today&run=1&page=2`)
  })

  it('offers all campaigns plus quick and custom time ranges', () => {
    const allCampaignsReport: ProspectingCallReport = {
      ...report,
      campaign: { id: null, name: 'All campaigns', status: 'all', currentRunNumber: null },
      runNumber: null,
    }
    render(<ProspectingCallReportView report={allCampaignsReport} campaigns={[campaign]} page={1} range={range} today="2026-09-03" view="calls" selectedSessionId={null} sort="called" direction="desc" />)

    expect(screen.getByRole('combobox', { name: 'Report campaign' })).toHaveDisplayValue('All campaigns')
    expect(screen.getByRole('combobox', { name: 'Campaign run' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    expect(screen.getByRole('dialog', { name: 'Choose reporting date range' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Last 7 days/ })).toBeVisible()
    expect(screen.getByLabelText('Custom range start')).toBeVisible()
    expect(screen.getAllByText(campaign.name).length).toBeGreaterThan(1)
  })

  it('shows expandable session details and authenticated recording playback', () => {
    const sessionReport: ProspectingCallReport = { ...report, selectedSessionCalls: report.attempts.items }
    render(<ProspectingCallReportView report={sessionReport} campaigns={[campaign]} page={1} range={range} today="2026-09-03" view="sessions" selectedSessionId={report.sessions[0].id} sort="called" direction="desc" />)

    expect(screen.getByRole('heading', { name: 'List batches and performance' })).toBeVisible()
    expect(screen.getByText('Calls in this session')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Hide' })).toBeVisible()

    const { unmount } = render(<ProspectingCallReportView report={report} campaigns={[campaign]} page={1} range={range} today="2026-09-03" view="recordings" selectedSessionId={null} sort="called" direction="desc" />)
    const audio = document.querySelector('audio')
    expect(audio).toHaveAttribute('src', '/api/recordings/RE123')
    unmount()
  })
})
