/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProspectingCampaignDetail } from '@/lib/prospecting/campaign-contract'
import { ProspectingWorkspace } from './prospecting-workspace'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/conversations/workspace-frame', () => ({ WorkspaceChrome: () => null }))
vi.mock('@/components/prospecting/campaign-audience-review', () => ({ CampaignAudienceReview: () => null }))
vi.mock('@/components/prospecting/campaign-studio', () => ({
  EMPTY_CAMPAIGN_FORM: { name: '', kind: 'sms', callerId: '', fromPhone: '', defaultTimezone: 'America/Chicago', sendWindowStart: '09:00', sendWindowEnd: '19:00', sendDays: [1], perHour: 1, perDay: 1, steps: [{ delayMinutes: 0, bodyTemplate: '' }] },
  CampaignStudio: () => null,
}))
vi.mock('@/components/prospecting/campaign-dashboard', () => ({
  CampaignDashboard: ({ detail, detailLoading, liveRefreshDelayed }: { detail: ProspectingCampaignDetail | null; detailLoading: boolean; liveRefreshDelayed: boolean }) => <div>
    <span>{detailLoading ? 'loading' : 'ready'}</span>
    <span>Sent {detail?.stats.sent ?? 0}</span>
    <span>{liveRefreshDelayed ? 'delayed' : 'current'}</span>
  </div>,
}))

const baseCampaign: ProspectingCampaignDetail = {
  id: 'campaign-1', name: 'Live sellers', kind: 'sms', status: 'active', ownerEmail: 'ernest@savingkc.com', ownerName: 'Ernest', callerId: null, fromPhone: '+18164292900', defaultTimezone: 'America/Chicago', sendWindowStart: '09:00', sendWindowEnd: '19:00', sendDays: [1, 2, 3, 4, 5, 6], perHour: 25, perDay: 100, createdAt: '2026-08-21T20:00:00.000Z', updatedAt: '2026-08-21T20:00:00.000Z', activatedAt: '2026-08-21T20:00:00.000Z', pausedAt: null, completedAt: null,
  steps: [{ id: 'step-1', position: 1, delayMinutes: 0, bodyTemplate: 'Hello' }], members: [], stats: { total: 1, active: 1, needsReview: 0, suppressed: 0, replied: 0, completed: 0, sent: 1, delivered: 1, failed: 0 }, operations: { queued: 0, processing: 0, nextActionAt: null, lastSentAt: '2026-08-21T20:00:00.000Z' },
}

async function flushEffects() {
  for (let index = 0; index < 6; index += 1) await act(async () => { await Promise.resolve() })
}

describe('ProspectingWorkspace live campaign refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('quietly refreshes only the selected active campaign while the page is visible', async () => {
    let detailLoads = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('?limit=50')) return { ok: true, json: async () => ({ items: [baseCampaign], pageInfo: { hasMore: false, nextCursor: null } }) }
      detailLoads += 1
      return { ok: true, json: async () => ({ campaign: { ...baseCampaign, stats: { ...baseCampaign.stats, sent: detailLoads } } }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ProspectingWorkspace />)
    await flushEffects()
    expect(screen.getByText('Sent 1')).toBeVisible()
    expect(screen.getByText('ready')).toBeVisible()

    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(screen.getByText('Sent 2')).toBeVisible()
    expect(screen.getByText('ready')).toBeVisible()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(detailLoads).toBe(2)
  })
})
