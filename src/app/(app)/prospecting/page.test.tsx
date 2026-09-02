/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProspectingCampaignDetail } from '@/lib/prospecting/campaign-contract'

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  listCampaigns: vi.fn(),
  getCampaign: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveActor }))
vi.mock('@/lib/server/prospecting-campaigns', () => ({
  listProspectingCampaigns: mocks.listCampaigns,
  getProspectingCampaign: mocks.getCampaign,
}))
vi.mock('@/lib/preview-safety', () => ({ previewWriteBlocked: () => false }))
vi.mock('@/components/prospecting/prospecting-calling-floor', () => ({
  ProspectingCallingFloor: ({ previewCampaignId }: { previewCampaignId?: string | null }) => <main data-testid="calling-floor" data-preview-id={previewCampaignId ?? ''} />,
}))
vi.mock('@/components/prospecting/prospecting-workspace', () => ({
  ProspectingWorkspace: ({ initialDetail, initialCampaigns }: { initialDetail?: ProspectingCampaignDetail | null; initialCampaigns?: unknown[] }) => (
    <main data-testid="prospecting-workspace" data-campaign={initialDetail?.name ?? ''} data-count={initialCampaigns?.length ?? -1} data-member-count={initialDetail?.members.length ?? -1} />
  ),
}))

import ProspectingPage from './page'

const campaign: ProspectingCampaignDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Current calling campaign',
  kind: 'dialer',
  status: 'active',
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
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-02T12:00:00.000Z',
  activatedAt: '2026-09-01T12:00:00.000Z',
  pausedAt: null,
  completedAt: null,
  steps: [],
  members: [],
  stats: { total: 167, active: 167, needsReview: 0, suppressed: 2, replied: 0, completed: 0, sent: 0, delivered: 0, failed: 0 },
  operations: { queued: 0, processing: 0, nextActionAt: null, lastSentAt: null },
}

describe('Prospecting page first paint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveActor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.listCampaigns.mockResolvedValue({ items: [campaign], pageInfo: { hasMore: false, nextCursor: null } })
    mocks.getCampaign.mockResolvedValue(campaign)
  })

  it('passes the selected campaign to the client workspace on the first render', async () => {
    render(await ProspectingPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByTestId('prospecting-workspace')).toHaveAttribute('data-campaign', campaign.name)
    expect(screen.getByTestId('prospecting-workspace')).toHaveAttribute('data-count', '1')
    expect(screen.getByTestId('prospecting-workspace')).toHaveAttribute('data-member-count', '0')
    expect(mocks.getCampaign).toHaveBeenCalledWith(expect.any(Object), campaign.id)
  })

  it('keeps calling-session routes on the focused calling floor', async () => {
    render(await ProspectingPage({ searchParams: Promise.resolve({ session_id: 'session-1' }) }))

    expect(screen.getByTestId('calling-floor')).toBeVisible()
    expect(mocks.resolveActor).not.toHaveBeenCalled()
  })
})
