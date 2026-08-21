/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProspectingCampaignDetail, ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'
import { CampaignDashboard } from './campaign-dashboard'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

const detail: ProspectingCampaignDetail = {
  id: 'campaign-1',
  name: 'September absentee owners',
  kind: 'sms',
  status: 'active',
  ownerEmail: 'ernest@savingkc.com',
  ownerName: 'Ernest',
  callerId: null,
  fromPhone: '+18165550101',
  defaultTimezone: 'America/Chicago',
  perHour: 75,
  perDay: 500,
  createdAt: '2026-08-21T10:00:00.000Z',
  updatedAt: '2026-08-21T11:00:00.000Z',
  activatedAt: '2026-08-21T11:00:00.000Z',
  pausedAt: null,
  completedAt: null,
  steps: [{ id: 'step-1', position: 1, delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, would you consider an offer?' }],
  members: [{
    id: 'member-1',
    leadId: 'lead-1',
    phone: '+18165550123',
    timezone: 'America/Chicago',
    status: 'active',
    suppressionReason: null,
    currentStepPosition: 1,
    nextActionAt: '2026-08-22T14:00:00.000Z',
    enrolledAt: '2026-08-21T10:30:00.000Z',
    lead: { fullName: 'Helen Seller', propertyAddress: '123 Main Street', station: 'prospect', classification: 'warm' },
  }],
  stats: { total: 10, active: 7, suppressed: 1, replied: 2, completed: 1, sent: 8, failed: 0 },
}

const campaigns: ProspectingCampaignSummary[] = [detail, { ...detail, id: 'campaign-2', name: 'Calling block', kind: 'dialer', status: 'draft' }]

describe('CampaignDashboard', () => {
  it('shows campaign pulse, sequence, audience health, and server-enforced safety', () => {
    render(<CampaignDashboard campaigns={campaigns} selectedId={detail.id} detail={detail} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)

    expect(screen.getByRole('heading', { name: detail.name })).toBeVisible()
    expect(screen.getByText('25% reply rate')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'The conversation sellers receive' })).toBeVisible()
    expect(screen.getByText('Helen Seller')).toBeVisible()
    expect(screen.getByText('Protected at every action')).toBeVisible()
    expect(screen.getByText('DNC and STOP')).toBeVisible()
  })

  it('filters the campaign rail without changing server state', () => {
    render(<CampaignDashboard campaigns={campaigns} selectedId={detail.id} detail={detail} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'draft' }))
    expect(screen.getByRole('button', { name: /Calling block/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /September absentee owners/ })).not.toBeInTheDocument()
  })

  it('does not relabel SMS delivery totals as dialer activity', () => {
    const dialerDetail: ProspectingCampaignDetail = { ...detail, kind: 'dialer', callerId: '+18165550199', fromPhone: null, steps: [] }
    render(<CampaignDashboard campaigns={[dialerDetail]} selectedId={dialerDetail.id} detail={dialerDetail} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)

    expect(screen.getByText('Ready to call')).toBeVisible()
    expect(screen.getByText('Eligible')).toBeVisible()
    expect(screen.queryByText('Messages sent')).not.toBeInTheDocument()
    expect(screen.queryByText('Calls worked')).not.toBeInTheDocument()
  })
})
