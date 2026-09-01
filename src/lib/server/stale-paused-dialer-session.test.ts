import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/lib/server/dialer-session-engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/dialer-session-engine')>('@/lib/server/dialer-session-engine')
  return {
    ...actual,
    parseDialerSession: vi.fn((value: { id?: string }) => ({ id: value.id, status: 'stopped' })),
  }
})

import {
  clearStalePausedDialerSession,
  findStalePausedDialerHardStop,
  hardStopFromOpenSession,
  listStalePausedDialerHardStops,
} from './stale-paused-dialer-session'

const listed = {
  id: '11355a3b-e5fa-4ecf-8cff-7720fa2428cb',
  status: 'paused',
  actorEmail: 'ernest@savingkc.com',
  agentName: 'Ernest A. Dodson III',
  prospectingCampaignId: '74609ed4-7e26-4111-b626-b2e3f68efa0b',
  campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
  startedAt: '2026-08-31T12:53:54.838Z',
  pausedAt: '2026-09-01T16:55:40.491Z',
  endedAt: null,
  attemptCountToday: 0,
}

describe('stale paused dialer session server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists only sessions the shared predicate still treats as stale paused', async () => {
    mocks.rpc.mockResolvedValue({ data: [listed, { ...listed, id: 'not-a-uuid', attemptCountToday: 0 }], error: null })
    const stops = await listStalePausedDialerHardStops()
    expect(mocks.rpc).toHaveBeenCalledWith('list_stale_paused_dialer_sessions_v1')
    expect(stops).toEqual([expect.objectContaining({
      sessionId: listed.id,
      campaignId: listed.prospectingCampaignId,
      cannotStartNew: true,
      andonCapable: true,
      reasons: ['zero_attempts_today', 'paused_past_sla'],
    })])
  })

  it('prefers the signed-in actor hard stop, then the selected campaign', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { ...listed, actorEmail: 'casey@savingkc.com', prospectingCampaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', campaignName: 'Other' },
        listed,
      ],
      error: null,
    })
    await expect(findStalePausedDialerHardStop({
      actor: { email: 'ernest@savingkc.com', name: 'Ernest' },
      campaignId: listed.prospectingCampaignId,
    })).resolves.toMatchObject({ sessionId: listed.id, actorEmail: 'ernest@savingkc.com' })
  })

  it('clears through the service-role RPC and never invents a CRON secret', async () => {
    mocks.rpc.mockResolvedValue({
      data: { cleared: true, alreadyEnded: false, session: { id: listed.id } },
      error: null,
    })
    await expect(clearStalePausedDialerSession({
      sessionId: listed.id,
      actorEmail: 'casey@savingkc.com',
      reason: 'stale_paused_session_cleared',
    })).resolves.toMatchObject({ cleared: true, hardStop: null, session: { id: listed.id } })
    expect(mocks.rpc).toHaveBeenCalledWith('clear_stale_paused_dialer_session_v1', {
      p_session_id: listed.id,
      p_actor_email: 'casey@savingkc.com',
      p_reason: 'stale_paused_session_cleared',
    })
  })

  it('refuses to clear a live or not-stale session', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'session_not_stale_paused' } })
    await expect(clearStalePausedDialerSession({
      sessionId: listed.id,
      actorEmail: 'casey@savingkc.com',
    })).rejects.toMatchObject({ code: 'session_not_stale_paused', status: 409 })
  })

  it('rebuilds a hard stop from an already-loaded open session', () => {
    expect(hardStopFromOpenSession({
      id: listed.id,
      status: 'paused',
      actorEmail: listed.actorEmail,
      agentName: listed.agentName,
      startedAt: listed.startedAt,
      pausedAt: listed.pausedAt,
      endedAt: null,
      settingsSnapshot: {
        campaignName: listed.campaignName,
        prospectingCampaignId: listed.prospectingCampaignId,
      },
    }, 0, new Date('2026-09-01T20:14:00.000Z'))).toMatchObject({
      cannotStartNew: true,
      reasons: ['zero_attempts_today', 'paused_past_sla'],
    })
  })
})
