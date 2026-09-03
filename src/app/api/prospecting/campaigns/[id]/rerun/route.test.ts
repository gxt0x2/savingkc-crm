import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), rerun: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaigns', () => ({
  ProspectingCampaignError: class ProspectingCampaignError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  rerunProspectingDialerCampaign: mocks.rerun,
}))

import { POST } from './route'

const campaignId = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id: campaignId }) }

function request(body: unknown) {
  return new Request(`https://crm.savingkc.com/api/prospecting/campaigns/${campaignId}/rerun`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('prospecting campaign rerun route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.rerun.mockResolvedValue({ id: campaignId, status: 'active', runNumber: 2, resetMembers: 61 })
  })

  it('requires an explicit confirmation before reopening completed members', async () => {
    const response = await POST(request({}), context)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'rerun_confirmation_required' })
    expect(mocks.rerun).not.toHaveBeenCalled()
  })

  it('starts a new run under the authenticated actor', async () => {
    const response = await POST(request({ confirmed: true }), context)

    expect(response.status).toBe(200)
    expect(mocks.rerun).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      campaignId,
    )
    expect(await response.json()).toEqual({
      campaign: { id: campaignId, status: 'active', runNumber: 2, resetMembers: 61 },
    })
  })

  it('rejects anonymous reruns before reading the request body', async () => {
    mocks.actor.mockResolvedValue(null)
    const input = request({ confirmed: true })
    const read = vi.spyOn(input, 'text')

    const response = await POST(input, context)

    expect(response.status).toBe(401)
    expect(read).not.toHaveBeenCalled()
    expect(mocks.rerun).not.toHaveBeenCalled()
  })
})
