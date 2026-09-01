import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getOpenSession: vi.fn(),
  getControlSummary: vi.fn(),
  parseSession: vi.fn(),
  findHardStop: vi.fn(),
}))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  getOpenDialerSession: mocks.getOpenSession,
  getDialerSessionControlSummary: mocks.getControlSummary,
  parseDialerSession: mocks.parseSession,
}))
vi.mock('@/lib/server/stale-paused-dialer-session', () => ({
  findStalePausedDialerHardStop: mocks.findHardStop,
  stalePausedHardStopMessage: (stop: { campaignName: string; sessionId: string }) =>
    `${stop.campaignName} · ${stop.sessionId.slice(0, 8)} is a stale paused hard stop`,
}))

import { launchProspectingDialerCampaign } from '@/lib/server/prospecting-campaigns'

const actor = { email: 'ernest@savingkc.com', name: 'Ernest' }
const campaignId = '11111111-1111-4111-8111-111111111111'
const setup = {
  startBehavior: 'resume' as const,
  callerMode: 'static' as const,
  callerIds: ['+18163100845'],
  ringCount: 7 as const,
  notDialedHours: null,
  notContactedHours: null,
}
const control = {
  token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  label: 'Chrome on Mac',
  takeover: false,
  expectedGeneration: null,
  requestId: null,
}
const campaignRow = {
  id: campaignId,
  name: 'August Absentee',
  kind: 'dialer',
  status: 'active',
  owner_email: actor.email,
  owner_name: actor.name,
  caller_id: '+18166088770',
  from_phone: null,
  default_timezone: 'America/Chicago',
  send_window_start: '09:00:00',
  send_window_end: '19:00:00',
  send_days: [1, 2, 3, 4, 5, 6],
  per_hour: 150,
  per_day: 1000,
  created_at: '2026-08-21T00:00:00.000Z',
  updated_at: '2026-08-21T00:00:00.000Z',
  activated_at: '2026-08-21T00:00:00.000Z',
  paused_at: null,
  completed_at: null,
}

function query(data: unknown = []) {
  const result = Promise.resolve({ data, error: null, count: 0 })
  const chain: Record<string, unknown> = { then: result.then.bind(result) }
  for (const method of ['select', 'eq', 'neq', 'in', 'not', 'contains', 'order', 'limit']) chain[method] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }))
  return chain
}

describe('launchProspectingDialerCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockImplementation((table: string) => table === 'prospecting_campaigns' ? query(campaignRow) : query())
    mocks.getOpenSession.mockResolvedValue(null)
    mocks.parseSession.mockReturnValue({ id: 'session-1' })
    mocks.findHardStop.mockResolvedValue(null)
  })

  it('delegates batch claiming and session creation to one server transaction', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: { created: true, session: { id: 'session-1' }, batchSize: 100, remaining: 42 }, error: null }))
    const result = await launchProspectingDialerCampaign(actor, campaignId, setup, control)

    expect(mocks.rpc).toHaveBeenCalledWith('start_prospecting_dialer_session_v5', {
      p_campaign_id: campaignId,
      p_actor_email: actor.email,
      p_actor_name: actor.name,
      p_caller_id: '+18163100845',
      p_session_setup: setup,
      p_controller_token: control.token,
      p_controller_label: control.label,
      p_takeover: false,
      p_expected_generation: null,
      p_request_id: null,
    })
    expect(result).toEqual({ created: true, session: { id: 'session-1' }, batchSize: 100, remaining: 42 })
  })

  it('passes the explicit first-unworked choice into the atomic session start', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: { created: true, session: { id: 'session-1' }, batchSize: 80, remaining: 0 }, error: null }))
    const firstUnworkedSetup = { ...setup, startBehavior: 'first_unworked' as const }
    await launchProspectingDialerCampaign(actor, campaignId, firstUnworkedSetup, {
      ...control,
      takeover: true,
      expectedGeneration: 3,
      requestId: 'takeover-3',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('start_prospecting_dialer_session_v5', expect.objectContaining({
      p_session_setup: firstUnworkedSetup,
      p_controller_token: control.token,
      p_takeover: true,
      p_expected_generation: 3,
      p_request_id: 'takeover-3',
    }))
  })

  it('returns an actionable message after every ready contact is worked', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: null, error: { message: 'campaign_dialer_complete' } }))
    await expect(launchProspectingDialerCampaign(actor, campaignId, setup, control)).rejects.toMatchObject({
      code: 'campaign_dialer_complete',
      status: 409,
    })
  })

  it('returns safe session context when another browser already controls the open session', async () => {
    const openSession = {
      id: '398a33c0-c502-4de5-b2d8-8b0092849ddc',
      currentIndex: 17,
      queueSize: 166,
      settingsSnapshot: { campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30' },
    }
    const details = {
      sessionId: openSession.id,
      campaignId,
      campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      status: 'active',
      currentIndex: 17,
      queueSize: 166,
      controllerLabel: 'Safari on Mac',
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
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: null, error: { message: 'session_control_conflict' } }))
    mocks.getOpenSession.mockResolvedValue(openSession)
    mocks.getControlSummary.mockResolvedValue(details)

    await expect(launchProspectingDialerCampaign(actor, campaignId, setup, control)).rejects.toMatchObject({
      code: 'session_control_conflict',
      status: 409,
      details,
    })
    expect(mocks.getControlSummary).toHaveBeenCalledWith(actor, openSession.id)
  })

  it('identifies the open campaign, session, and seller when an unfinished call blocks launch changes', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: null, error: { message: 'call_in_progress' } }))
    mocks.getOpenSession.mockResolvedValue({
      id: '398a33c0-c502-4de5-b2d8-8b0092849ddc',
      currentIndex: 17,
      queueSize: 166,
      settingsSnapshot: { campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30' },
    })

    await expect(launchProspectingDialerCampaign(actor, campaignId, setup, control)).rejects.toMatchObject({
      code: 'call_in_progress',
      status: 409,
      message: '“Jackson · Tax 3+ · 7 zips · Aug 30” · session 398a33c0 · seller 18 of 166 has an unfinished call. Resume it and save the outcome before changing the start position.',
    })
  })

  it('verifies a paused open session still blocks switching campaigns', async () => {
    const openSession = {
      id: '11355a3b-e5fa-4ecf-8cff-7720fa2428cb',
      currentIndex: 0,
      queueSize: 100,
      settingsSnapshot: { campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30' },
    }
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: null, error: { message: 'another_dialer_session_open' } }))
    mocks.getOpenSession.mockResolvedValue(openSession)
    mocks.getControlSummary.mockResolvedValue({
      sessionId: openSession.id,
      campaignId: campaignId,
      campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      status: 'paused',
      currentIndex: 0,
      queueSize: 100,
      canTakeOver: true,
    })

    await expect(launchProspectingDialerCampaign(actor, '22222222-2222-4222-8222-222222222222', setup, control)).rejects.toMatchObject({
      code: 'another_dialer_session_open',
      status: 409,
      message: expect.stringContaining('still open'),
    })
  })

  it('blocks a new start while a stale paused session is the hard stop', async () => {
    const hardStop = {
      code: 'stale_paused_session_blocks_start' as const,
      sessionId: '11355a3b-e5fa-4ecf-8cff-7720fa2428cb',
      campaignId,
      campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      actorEmail: actor.email,
      actorName: actor.name,
      status: 'paused' as const,
      pausedAt: '2026-09-01T16:55:40.491Z',
      startedAt: '2026-08-31T12:53:54.838Z',
      attemptCountToday: 0,
      reasons: ['zero_attempts_today' as const],
      cannotStartNew: true as const,
      andonCapable: true as const,
    }
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: null, error: { message: 'stale_paused_session_blocks_start' } }))
    mocks.findHardStop.mockResolvedValue(hardStop)

    await expect(launchProspectingDialerCampaign(actor, campaignId, setup, control)).rejects.toMatchObject({
      code: 'stale_paused_session_blocks_start',
      status: 409,
      hardStop,
      message: expect.stringContaining('stale paused hard stop'),
    })
  })

  it('keeps the safe fallback when open-session details cannot be loaded', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: null, error: { message: 'call_in_progress' } }))
    mocks.getOpenSession.mockRejectedValue(new Error('diagnostic unavailable'))

    await expect(launchProspectingDialerCampaign(actor, campaignId, setup, control)).rejects.toMatchObject({
      code: 'call_in_progress',
      status: 409,
      message: 'Finish and save the current call before changing where the session begins',
    })
  })
})
