/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ProspectingCampaignDetail,
  ProspectingDialerSessionSetup,
} from '@/lib/prospecting/campaign-contract'
import { ProspectingWorkspace } from './prospecting-workspace'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  dialerControllerHeaders: vi.fn(async () => ({ 'X-Dialer-Controller': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
  newDialerControlRequestId: vi.fn(() => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  publishDialerControlTaken: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.routerPush }) }))
vi.mock('@/components/conversations/workspace-frame', () => ({ WorkspaceChrome: () => null }))
vi.mock('@/components/prospecting/campaign-audience-review', () => ({ CampaignAudienceReview: () => null }))
vi.mock('@/components/prospecting/campaign-studio', () => ({
  EMPTY_CAMPAIGN_FORM: { name: '', kind: 'sms', callerId: '', fromPhone: '', defaultTimezone: 'America/Chicago', sendWindowStart: '09:00', sendWindowEnd: '19:00', sendDays: [1], perHour: 1, perDay: 1, steps: [{ delayMinutes: 0, bodyTemplate: '' }] },
  CampaignStudio: () => null,
}))
vi.mock('@/components/prospecting/campaign-dashboard', () => ({
  CampaignDashboard: ({
    detail,
    onLaunchDialer,
  }: {
    detail: ProspectingCampaignDetail | null
    onLaunchDialer: (setup: ProspectingDialerSessionSetup) => void
  }) => <div>
    <span>{detail?.name || 'No campaign'}</span>
    <button type="button" disabled={!detail} onClick={() => onLaunchDialer({
      startBehavior: 'resume',
      callerMode: 'static',
      callerIds: ['+18163100845'],
      ringCount: 7,
      notDialedHours: null,
      notContactedHours: null,
    })}>Start calling</button>
  </div>,
}))
vi.mock('@/lib/telephony/dialer-controller-client', () => ({
  dialerControllerHeaders: mocks.dialerControllerHeaders,
  newDialerControlRequestId: mocks.newDialerControlRequestId,
  publishDialerControlTaken: mocks.publishDialerControlTaken,
}))

const selectedCampaign: ProspectingCampaignDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Deceased owners',
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
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T11:00:00.000Z',
  activatedAt: '2026-08-31T11:00:00.000Z',
  pausedAt: null,
  completedAt: null,
  steps: [],
  members: [],
  stats: { total: 25, active: 25, needsReview: 0, suppressed: 0, replied: 0, completed: 0, sent: 0, delivered: 0, failed: 0 },
  operations: { queued: 0, processing: 0, nextActionAt: null, lastSentAt: null },
}

const existingSessionId = '00000000-0000-4000-8000-000000000010'
const existingCampaignId = '22222222-2222-4222-8222-222222222222'
const conflictDetails = {
  sessionId: existingSessionId,
  campaignId: existingCampaignId,
  campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
  status: 'paused',
  currentIndex: 17,
  queueSize: 166,
  controllerLabel: 'Chrome on Casey’s PC',
  heartbeatAt: '2026-08-31T20:00:00.000Z',
  leaseExpiresAt: '2026-08-31T20:00:45.000Z',
  generation: 4,
  stale: false,
  attemptStatus: null,
  operationActive: false,
  operationLabel: null,
  operationExpiresAt: null,
  canTakeOver: true,
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/prospecting/campaigns?limit=50') {
      return response({ items: [selectedCampaign], pageInfo: { hasMore: false, nextCursor: null } })
    }
    if (url === `/api/prospecting/campaigns/${selectedCampaign.id}` && !init?.method) {
      return response({ campaign: selectedCampaign, capabilities: { writesEnabled: true } })
    }
    if (url === `/api/prospecting/campaigns/${selectedCampaign.id}/launch`) {
      return response({
        error: 'Another browser is controlling this dialing session',
        code: 'session_control_conflict',
        details: conflictDetails,
      }, 409)
    }
    if (url === `/api/dialer/sessions/${existingSessionId}/control`) {
      return response({
        session: {
          id: existingSessionId,
          status: 'paused',
          settingsSnapshot: { ringCount: 6, prospectingCampaignId: existingCampaignId },
        },
        control: { generation: 5 },
        transferred: true,
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

async function openConflict() {
  render(<ProspectingWorkspace />)
  const start = await screen.findByRole('button', { name: 'Start calling' })
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  return screen.findByRole('alertdialog', { name: 'Continue this dialing session here?' })
}

describe('ProspectingWorkspace session takeover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the conflicting session context and Cancel performs no takeover mutation', async () => {
    const fetchMock = installFetch()
    vi.stubGlobal('fetch', fetchMock)

    await openConflict()

    expect(screen.getAllByText(conflictDetails.campaignName).length).toBeGreaterThan(0)
    expect(screen.getByText('Seller 18 of 166')).toBeVisible()
    expect(screen.getByText('Chrome on Casey’s PC')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/control'))).toBe(false)
    expect(mocks.routerPush).not.toHaveBeenCalled()
    expect(mocks.publishDialerControlTaken).not.toHaveBeenCalled()
  })

  it('continues the preserved session through its direct control endpoint and navigates there', async () => {
    const fetchMock = installFetch()
    vi.stubGlobal('fetch', fetchMock)

    await openConflict()
    fireEvent.click(screen.getByRole('button', { name: 'Continue here' }))

    await waitFor(() => expect(mocks.routerPush).toHaveBeenCalledOnce())
    const controlCall = fetchMock.mock.calls.find(([input]) => String(input) === `/api/dialer/sessions/${existingSessionId}/control`)
    expect(controlCall).toBeDefined()
    const controlInit = controlCall?.[1]
    expect(controlInit).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Dialer-Controller': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    })
    expect(JSON.parse(String(controlInit?.body))).toEqual({
      action: 'takeover',
      expectedGeneration: 4,
      requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/launch'))).toHaveLength(1)
    expect(mocks.publishDialerControlTaken).toHaveBeenCalledWith(existingSessionId, 5)
    expect(mocks.routerPush).toHaveBeenCalledWith(expect.stringMatching(
      new RegExp(`^/prospecting\\?session_id=${existingSessionId}&campaign=${existingCampaignId}`),
    ))
    expect(window.sessionStorage.getItem(`savingkc:dialer-autostart:${existingSessionId}`)).toBeNull()
  })
})
