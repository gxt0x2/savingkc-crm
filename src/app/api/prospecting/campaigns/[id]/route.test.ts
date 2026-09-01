import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), get: vi.fn(), preset: vi.fn(), transition: vi.fn(), update: vi.fn(), hardStop: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaigns', () => ({
  ProspectingCampaignError: class ProspectingCampaignError extends Error {},
  getProspectingCampaign: mocks.get,
  saveProspectingDialerPreset: mocks.preset,
  setProspectingCampaignStatus: mocks.transition,
  updateProspectingCampaignDraft: mocks.update,
}))
vi.mock('@/lib/server/stale-paused-dialer-session', () => ({
  findStalePausedDialerHardStop: mocks.hardStop,
}))

import { GET, PATCH } from './route'

const params = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }

describe('prospecting campaign transition route', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.transition.mockResolvedValue({ id: 'campaign-1', status: 'active' })
    mocks.preset.mockImplementation(async (_actor, _campaignId, setup) => setup)
    mocks.update.mockResolvedValue({ id: 'campaign-1', status: 'draft' })
    mocks.hardStop.mockResolvedValue(null)
  })

  it('tells the client when a preview may only open the read-only calling workflow', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    mocks.get.mockResolvedValue({ id: 'campaign-1', status: 'active' })
    const response = await GET(new Request('https://preview.vercel.app/api/prospecting/campaigns/x'), params)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ capabilities: { writesEnabled: false } })
  })

  it('keeps real session launches available outside read-only previews', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    mocks.get.mockResolvedValue({ id: 'campaign-1', status: 'active' })
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x'), params)
    await expect(response.json()).resolves.toMatchObject({ capabilities: { writesEnabled: true, canClearStalePausedSession: true }, hardStop: null })
  })

  it('surfaces a stale paused hard stop on the selected campaign', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    mocks.get.mockResolvedValue({ id: 'campaign-1', status: 'active' })
    mocks.hardStop.mockResolvedValue({
      code: 'stale_paused_session_blocks_start',
      sessionId: '11355a3b-e5fa-4ecf-8cff-7720fa2428cb',
      cannotStartNew: true,
    })
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x'), params)
    await expect(response.json()).resolves.toMatchObject({
      hardStop: { cannotStartNew: true, sessionId: '11355a3b-e5fa-4ecf-8cff-7720fa2428cb' },
    })
  })

  it('rejects anonymous transitions before parsing the body', async () => {
    mocks.actor.mockResolvedValue(null)
    const request = new Request('https://crm.savingkc.com/api/prospecting/campaigns/x', { method: 'PATCH', body: '{}' })
    const parse = vi.spyOn(request, 'json')
    const response = await PATCH(request, params)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  it('requires an explicit reviewed activation confirmation', async () => {
    const response = await PATCH(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x', { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }), params)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'activation_confirmation_required' })
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  it('activates only after the authenticated operator confirms', async () => {
    const response = await PATCH(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x', { method: 'PATCH', body: JSON.stringify({ status: 'active', confirmed: true }) }), params)
    expect(response.status).toBe(200)
    expect(mocks.transition).toHaveBeenCalledWith({ email: 'ernest@savingkc.com', name: 'Ernest' }, '11111111-1111-4111-8111-111111111111', 'active')
  })

  it('validates and saves a draft setup through the actor-owned update boundary', async () => {
    const setup = {
      name: 'August Absentee corrected',
      kind: 'dialer',
      callerId: '+18166088770',
      defaultTimezone: 'America/Chicago',
      perHour: 75,
      perDay: 500,
      steps: [],
    }
    const response = await PATCH(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x', {
      method: 'PATCH',
      body: JSON.stringify({ setup }),
    }), params)
    expect(response.status).toBe(200)
    expect(mocks.transition).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ name: setup.name, kind: 'dialer', callerId: setup.callerId }),
    )
  })

  it('validates and saves an agent-specific dialer preset', async () => {
    const dialerPreset = {
      startBehavior: 'resume',
      callerMode: 'static',
      callerIds: ['+18163100845'],
      ringCount: 5,
      notDialedHours: 24,
      notContactedHours: 72,
    }
    const response = await PATCH(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x', {
      method: 'PATCH',
      body: JSON.stringify({ dialerPreset }),
    }), params)

    expect(response.status).toBe(200)
    expect(mocks.preset).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      '11111111-1111-4111-8111-111111111111',
      dialerPreset,
    )
  })
})
