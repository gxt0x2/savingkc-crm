import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), parseSession: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@/lib/server/dialer-session-engine', () => ({ parseDialerSession: mocks.parseSession }))

import { launchProspectingDialerCampaign } from '@/lib/server/prospecting-campaigns'

const actor = { email: 'ernest@savingkc.com', name: 'Ernest' }
const campaignId = '11111111-1111-4111-8111-111111111111'
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
  for (const method of ['select', 'eq', 'neq', 'in', 'not', 'order', 'limit']) chain[method] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }))
  return chain
}

describe('launchProspectingDialerCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockImplementation((table: string) => table === 'prospecting_campaigns' ? query(campaignRow) : query())
    mocks.parseSession.mockReturnValue({ id: 'session-1' })
  })

  it('delegates batch claiming and session creation to one server transaction', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: { created: true, session: { id: 'session-1' }, batchSize: 100, remaining: 42 }, error: null }))
    const result = await launchProspectingDialerCampaign(actor, campaignId)

    expect(mocks.rpc).toHaveBeenCalledWith('start_prospecting_dialer_session_v3', {
      p_campaign_id: campaignId,
      p_actor_email: actor.email,
      p_actor_name: actor.name,
      p_caller_id: campaignRow.caller_id,
      p_start_behavior: 'resume',
    })
    expect(result).toEqual({ created: true, session: { id: 'session-1' }, batchSize: 100, remaining: 42 })
  })

  it('passes the explicit first-unworked choice into the atomic session start', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: { created: true, session: { id: 'session-1' }, batchSize: 80, remaining: 0 }, error: null }))
    await launchProspectingDialerCampaign(actor, campaignId, 'first_unworked')

    expect(mocks.rpc).toHaveBeenCalledWith('start_prospecting_dialer_session_v3', expect.objectContaining({
      p_start_behavior: 'first_unworked',
    }))
  })

  it('returns an actionable message after every ready contact is worked', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'prospecting_campaign_member_page_v3'
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: null, error: { message: 'campaign_dialer_complete' } }))
    await expect(launchProspectingDialerCampaign(actor, campaignId)).rejects.toMatchObject({
      code: 'campaign_dialer_complete',
      status: 409,
    })
  })
})
