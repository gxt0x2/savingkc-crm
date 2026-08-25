import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), launch: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-campaigns', () => ({ launchProspectingDialerCampaign: mocks.launch }))

import { POST } from './route'

const context = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }

describe('prospecting campaign launch route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.launch.mockResolvedValue({ created: false, session: { id: 'session-1' } })
  })

  it('defaults omitted launch behavior to resume', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/launch', {
      method: 'POST',
    }), context)

    expect(response.status).toBe(201)
    expect(mocks.launch).toHaveBeenCalledWith(
      { email: 'ernest@savingkc.com', name: 'Ernest' },
      '11111111-1111-4111-8111-111111111111',
      'resume',
    )
  })

  it('accepts the deliberate first-unworked behavior', async () => {
    await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startBehavior: 'first_unworked' }),
    }), context)

    expect(mocks.launch).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'first_unworked')
  })

  it('rejects an unknown start behavior before session mutation', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startBehavior: 'redial_everyone' }),
    }), context)

    expect(response.status).toBe(400)
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON instead of silently resuming', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    }), context)

    expect(response.status).toBe(400)
    expect(mocks.launch).not.toHaveBeenCalled()
  })

  it('rejects anonymous launches before reading the body', async () => {
    mocks.actor.mockResolvedValue(null)
    const request = new Request('https://crm.savingkc.com/api/prospecting/campaigns/x/launch', { method: 'POST' })
    const parse = vi.spyOn(request, 'text')
    const response = await POST(request, context)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
  })
})
