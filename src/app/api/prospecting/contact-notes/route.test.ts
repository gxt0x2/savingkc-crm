import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), load: vi.fn(), save: vi.fn(), assertDialerControl: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/api/dialer-mutation-control', () => ({
  assertDialerMutationControl: mocks.assertDialerControl,
  dialerMutationControlErrorResponse: (error: unknown) => {
    const typed = error as { code?: string; status?: number; message?: string }
    return typed.code
      ? Response.json({ error: typed.message, code: typed.code }, { status: typed.status || 409 })
      : null
  },
}))
vi.mock('@/lib/server/prospecting-contact-notes', () => ({
  loadProspectingContactNotes: mocks.load,
  saveProspectingContactNote: mocks.save,
}))

import { GET, POST } from './route'

const actor = { email: 'agent@savingkc.com', name: 'Agent Example' }

describe('POST /api/prospecting/contact-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue(actor)
    mocks.load.mockResolvedValue({ activities: [{ id: 'activity-1' }] })
    mocks.save.mockResolvedValue({ activity: { id: 'activity-1' } })
    mocks.assertDialerControl.mockResolvedValue(null)
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

  it('does not save when the dialer operation lease is no longer valid', async () => {
    mocks.assertDialerControl.mockRejectedValue(Object.assign(new Error('Dialing control moved'), {
      code: 'session_control_lost',
      status: 409,
    }))
    const input = {
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
      prospectId: 'prospect-1',
      contactKey: 'Lendel Lacy::owner',
      contactName: 'Lendel Lacy',
      description: 'Do not save from the stale window.',
    }

    const response = await POST(new Request('https://crm.savingkc.com/api/prospecting/contact-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }))

    expect(response.status).toBe(409)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('loads source-Prospect contact notes for the authenticated workspace', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/contact-notes?prospect_id=prospect%2F1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.load).toHaveBeenCalledWith('prospect/1')
    await expect(response.json()).resolves.toEqual({ activities: [{ id: 'activity-1' }] })
  })

  it('rejects anonymous source-Prospect note reads', async () => {
    mocks.actor.mockResolvedValue(null)

    const response = await GET(new Request('https://crm.savingkc.com/api/prospecting/contact-notes?prospect_id=prospect-1'))

    expect(response.status).toBe(401)
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
