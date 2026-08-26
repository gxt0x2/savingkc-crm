/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  sendWindowStart: '09:00',
  sendWindowEnd: '19:00',
  sendDays: [1, 2, 3, 4, 5, 6],
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
    subjectKind: 'lead',
    leadId: 'lead-1',
    prospectId: null,
    enrollmentSource: 'crm_lead',
    phone: '+18165550123',
    timezone: 'America/Chicago',
    status: 'active',
    suppressionReason: null,
    currentStepPosition: 1,
    nextActionAt: '2026-08-22T14:00:00.000Z',
    enrolledAt: '2026-08-21T10:30:00.000Z',
    readyContactCount: 1,
    suppressedContactCount: 0,
    lead: { fullName: 'Helen Seller', propertyAddress: '123 Main Street', station: 'prospect', classification: 'warm' },
  }],
  stats: { total: 1, active: 1, needsReview: 0, suppressed: 0, replied: 2, completed: 1, sent: 8, delivered: 6, failed: 0 },
  operations: { queued: 2, processing: 1, nextActionAt: '2026-08-22T14:00:00.000Z', lastSentAt: '2026-08-21T20:00:00.000Z' },
}

const campaigns: ProspectingCampaignSummary[] = [detail, { ...detail, id: 'campaign-2', name: 'Calling block', kind: 'dialer', status: 'draft' }]

describe('CampaignDashboard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).includes('/activity')
        ? { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } }
        : { items: detail.members, pageInfo: { limit: 50, hasMore: false, nextCursor: null } },
    })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps management detail out of the default agent workflow', () => {
    render(<CampaignDashboard campaigns={campaigns} selectedId={detail.id} detail={detail} loading={false} detailLoading={false} actionPending={false} lastRefreshedAt="2026-08-21T20:15:00.000Z" onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)

    expect(screen.getByRole('heading', { name: detail.name })).toBeVisible()
    expect(screen.getByText("Sends Monday–Saturday · 09:00–19:00 in each seller's local time")).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Choose campaign' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Campaign details/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Protected at every action')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Audience workbench' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Live · Synced/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps stale campaign data visible while reporting a delayed refresh', () => {
    render(<CampaignDashboard campaigns={campaigns} selectedId={detail.id} detail={detail} loading={false} detailLoading={false} actionPending={false} liveRefreshDelayed onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)
    expect(screen.getByRole('heading', { name: detail.name })).toBeVisible()
    expect(screen.getByText('Updates delayed')).toBeVisible()
  })

  it('changes the selected campaign from one compact control', () => {
    const select = vi.fn()
    render(<CampaignDashboard campaigns={campaigns} selectedId={detail.id} detail={detail} loading={false} detailLoading={false} actionPending={false} onSelect={select} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Choose campaign' }), { target: { value: 'campaign-2' } })
    expect(select).toHaveBeenCalledWith('campaign-2')
  })

  it('makes starting or resuming the dialer the single primary action', () => {
    const launch = vi.fn()
    const dialerDetail: ProspectingCampaignDetail = { ...detail, kind: 'dialer', callerId: '+18165550199', fromPhone: null, steps: [] }
    render(<CampaignDashboard campaigns={[dialerDetail]} selectedId={dialerDetail.id} detail={dialerDetail} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={launch} />)

    expect(screen.getByText('1', { selector: 'p' })).toBeVisible()
    expect(screen.getByText('ready to call')).toBeVisible()
    expect(screen.getByText('All associated contacts stay visible')).toBeVisible()
    expect(screen.getByRole('button', { name: /Session setup/ })).toHaveTextContent('stop after 7')
    const start = screen.getByRole('button', { name: 'Resume calling' })
    expect(start).toBeVisible()
    fireEvent.click(start)
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      startBehavior: 'resume',
      callerMode: 'static',
      callerIds: ['+18163100845'],
      maxAttemptsPerNumber: 7,
    }))
    expect(screen.queryByText('Calls worked')).not.toBeInTheDocument()
    expect(screen.queryByText('Audience health')).not.toBeInTheDocument()
  })

  it('keeps the same start action after calls have already been worked', () => {
    const dialerDetail: ProspectingCampaignDetail = {
      ...detail,
      kind: 'dialer',
      callerId: '+18165550199',
      fromPhone: null,
      steps: [],
      stats: { ...detail.stats, completed: 100, active: 125, total: 225 },
    }
    render(<CampaignDashboard campaigns={[dialerDetail]} selectedId={dialerDetail.id} detail={dialerDetail} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Resume calling' })).toBeVisible()
    expect(screen.getByText(/Your progress is preserved if you stop/i)).toBeVisible()
  })

  it('lets the agent deliberately restart from the first remaining unworked seller', () => {
    const launch = vi.fn()
    const dialerDetail: ProspectingCampaignDetail = { ...detail, kind: 'dialer', callerId: '+18165550199', fromPhone: null, steps: [] }
    render(<CampaignDashboard campaigns={[dialerDetail]} selectedId={dialerDetail.id} detail={dialerDetail} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={launch} />)

    fireEvent.click(screen.getByRole('button', { name: /Session setup/ }))
    fireEvent.click(screen.getByRole('radio', { name: /First unworked/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply setup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start calling' }))
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ startBehavior: 'first_unworked' }))
  })

  it('offers only cold-call lines and caps rotation at five', () => {
    const dialerDetail: ProspectingCampaignDetail = { ...detail, kind: 'dialer', callerId: '+18166088588', fromPhone: null, steps: [] }
    render(<CampaignDashboard campaigns={[dialerDetail]} selectedId={dialerDetail.id} detail={dialerDetail} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Session setup/ }))
    expect(screen.getByRole('region', { name: 'Calling session setup' })).toBeVisible()
    expect(screen.getByText('(816) 310-0845')).toBeVisible()
    expect(screen.queryByText('(816) 608-8588')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Maximum attempts per number' })).toHaveValue('7')
    expect(screen.getByRole('combobox', { name: 'Not dialed time frame' })).toHaveValue('')
  })

  it('keeps the complete session builder available in a safe read-only workflow preview', () => {
    const launch = vi.fn()
    const dialerDetail: ProspectingCampaignDetail = { ...detail, kind: 'dialer', callerId: '+18165550199', fromPhone: null, steps: [] }
    render(<CampaignDashboard campaigns={[dialerDetail]} selectedId={dialerDetail.id} detail={dialerDetail} loading={false} detailLoading={false} actionPending={false} writesEnabled={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={launch} />)

    const preview = screen.getByRole('button', { name: 'Preview call session' })
    expect(preview).toBeVisible()
    expect(screen.getByText(/15-second start sequence/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Resume calling' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Session setup/ }))
    expect(screen.getByRole('region', { name: 'Calling session setup' })).toBeVisible()
    expect(screen.getByRole('radio', { name: /Rotate numbers/ })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Maximum attempts per number' })).toBeVisible()
    fireEvent.click(preview)
    expect(launch).toHaveBeenCalledOnce()
  })

  it('loads audience and activity tools only after campaign details open', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      return { ok: true, json: async () => url.includes('/activity')
        ? { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } }
        : { items: detail.members, pageInfo: { limit: 50, hasMore: true, nextCursor: 'next-page' } } }
    }))
    render(<CampaignDashboard campaigns={campaigns} selectedId={detail.id} detail={{ ...detail, stats: { ...detail.stats, total: 101 } }} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)

    expect(screen.queryByRole('heading', { name: 'Audience workbench' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Campaign details/ }))
    expect(await screen.findByRole('heading', { name: 'Audience workbench' })).toBeVisible()
    expect(await screen.findByText('Helen Seller')).toBeVisible()
    expect(screen.getByText('Protected at every action')).toBeVisible()
    expect(screen.getByText('DNC and STOP')).toBeVisible()
  })

  it('carries a draft campaign into the contact audience selector', () => {
    const draft = { ...detail, status: 'draft' as const }
    render(<CampaignDashboard campaigns={[draft]} selectedId={draft.id} detail={draft} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Campaign details/ }))
    expect(screen.getByRole('link', { name: 'Add contacts' })).toHaveAttribute('href', `/contacts?list=prospects&campaign=${draft.id}&campaign_name=September+absentee+owners`)
  })

  it('hands the selected campaign to the setup-only duplicate flow', () => {
    const duplicate = vi.fn()
    render(<CampaignDashboard campaigns={campaigns} selectedId={detail.id} detail={detail} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={duplicate} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Campaign details/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate setup' }))
    expect(duplicate).toHaveBeenCalledWith(detail)
  })

  it('offers in-place setup editing only for a draft campaign', () => {
    const edit = vi.fn()
    const draft = { ...detail, status: 'draft' as const }
    const { rerender } = render(<CampaignDashboard campaigns={[draft]} selectedId={draft.id} detail={draft} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onEdit={edit} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Campaign details/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit setup' }))
    expect(edit).toHaveBeenCalledWith(draft)

    rerender(<CampaignDashboard campaigns={campaigns} selectedId={detail.id} detail={detail} loading={false} detailLoading={false} actionPending={false} onSelect={vi.fn()} onCreate={vi.fn()} onDuplicate={vi.fn()} onEdit={edit} onTransition={vi.fn()} onLaunchDialer={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Edit setup' })).not.toBeInTheDocument()
  })
})
