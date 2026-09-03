/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'
import type { ProspectingCallReport } from '@/lib/server/prospecting-call-report'
import { ProspectingCallReportView } from './prospecting-call-report'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
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
  metrics: { sessions: 1, agents: 1, attempts: 3, providerConnected: 2, reached: 1, resultsSaved: 2, failed: 1, uniqueNumbers: 3, durationSeconds: 88, skips: 0 },
  outcomes: { spoke_with_owner: 1, no_answer: 1 },
  runs: [{ runNumber: 1, sessions: 1, resultsSaved: 2, reached: 1, skips: 0, startedAt: '2026-09-02T18:00:00.000Z', lastActivityAt: '2026-09-02T19:00:00.000Z' }],
  agents: [{ email: 'casey@savingkc.com', name: 'Casey', sessions: 1, resultsSaved: 2, reached: 1, skips: 0 }],
  sessions: [{ id: '22222222-2222-4222-8222-222222222222', campaignId: campaign.id, campaignName: campaign.name, runNumber: 1, agentName: 'Casey', agentEmail: 'casey@savingkc.com', status: 'completed', queueSize: 3, resultsSaved: 2, reached: 1, skips: 0, outcomes: { spoke_with_owner: 1, no_answer: 1 }, startedAt: '2026-09-02T18:00:00.000Z', endedAt: '2026-09-02T19:00:00.000Z', updatedAt: '2026-09-02T19:00:00.000Z' }],
  attempts: {
    items: [{ id: '33333333-3333-4333-8333-333333333333', sessionId: '22222222-2222-4222-8222-222222222222', campaignId: campaign.id, campaignName: campaign.name, runNumber: 1, agentName: 'Casey', agentEmail: 'casey@savingkc.com', sellerName: 'Helen Seller', propertyAddress: '123 Main St', phone: '+18165550123', callerId: '+18163100845', status: 'dispositioned', disposition: 'spoke_with_owner', reached: true, durationSeconds: 88, createdAt: '2026-09-02T18:01:00.000Z', startedAt: '2026-09-02T18:01:01.000Z', connectedAt: '2026-09-02T18:01:05.000Z', endedAt: '2026-09-02T18:02:29.000Z' }],
    pageInfo: { limit: 50, offset: 0, total: 3, hasMore: false },
  },
}

describe('ProspectingCallReportView', () => {
  const range = { preset: 'today' as const, from: '2026-09-03', to: '2026-09-03', label: 'Today' }

  it('shows list metrics, agent results, called numbers, and dispositions', () => {
    render(<ProspectingCallReportView report={report} campaigns={[campaign]} page={1} range={range} today="2026-09-03" />)

    expect(screen.getByRole('heading', { name: 'Call performance' })).toBeVisible()
    expect(screen.getByRole('heading', { name: campaign.name })).toBeVisible()
    expect(screen.getAllByText('3', { selector: 'p' }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('(816) 555-0123')).toBeVisible()
    expect(screen.getAllByText('Reached Person').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Casey').length).toBeGreaterThan(0)
    expect(screen.getByRole('combobox', { name: 'Report campaign' })).toHaveDisplayValue(campaign.name)
    expect(screen.getByRole('navigation', { name: 'Prospecting sections' })).toHaveTextContent('Campaigns|Call Reports')
    expect(screen.getByRole('button', { name: 'Date range: Today' })).toBeVisible()
  })

  it('links back to the selected campaign and keeps paging filters scoped', () => {
    const nextReport = { ...report, runNumber: 1, attempts: { ...report.attempts, pageInfo: { ...report.attempts.pageInfo, hasMore: true } } }
    render(<ProspectingCallReportView report={nextReport} campaigns={[campaign]} page={1} range={range} today="2026-09-03" />)

    expect(screen.getByRole('link', { name: 'Campaigns' })).toHaveAttribute('href', '/prospecting')
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute('href', `/prospecting/reports?campaign=${campaign.id}&range=today&run=1&page=2`)
  })

  it('offers all campaigns plus quick and custom time ranges', () => {
    const allCampaignsReport: ProspectingCallReport = {
      ...report,
      campaign: { id: null, name: 'All campaigns', status: 'all', currentRunNumber: null },
      runNumber: null,
    }
    render(<ProspectingCallReportView report={allCampaignsReport} campaigns={[campaign]} page={1} range={range} today="2026-09-03" />)

    expect(screen.getByRole('combobox', { name: 'Report campaign' })).toHaveDisplayValue('All campaigns')
    expect(screen.getByRole('combobox', { name: 'Campaign run' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    expect(screen.getByRole('dialog', { name: 'Choose reporting date range' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Last 7 days/ })).toBeVisible()
    expect(screen.getByLabelText('Custom range start')).toBeVisible()
    expect(screen.getAllByText(campaign.name).length).toBeGreaterThan(1)
  })
})
