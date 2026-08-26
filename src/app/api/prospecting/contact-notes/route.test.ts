import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/prospecting-contact-notes', () => ({ saveProspectingContactNote: mocks.save }))

import { POST } from './route'

const actor = { email: 'agent@savingkc.com', name: 'Agent Example' }

describe('POST /api/prospecting/contact-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue(actor)
    mocks.save.mockResolvedValue({ activity: { id: 'activity-1' } })
  })

  it('rejects anonymous note writes before reading the request body', async () => {
    mocks.actor.mockResolvedValue(null)
    const request = new Request('https://crm.savingkc.com/api/prospecting/contact-notes', {
      method: 'POST',
      body: '{not-json',
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('attributes the contact note to the authenticated actor', async () => {
    const input = {
      campaignMemberId: 'member-1',
      prospectId: 'prospect-1',
      contactKey: 'Lendel Lacy::owner',
      contactName: 'Lendel Lacy',
      relation: 'owner',
      description: 'Sister handles the estate calls.',
    }
    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/contact-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }))

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.save).toHaveBeenCalledWith(actor, input)
  })
})
