import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), record: vi.fn() }))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/lead-disposition-command', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/lead-disposition-command')>(),
  recordLeadDisposition: mocks.record,
}))

import { POST } from './route'

const params = { params: Promise.resolve({ id: 'lead-1' }) }
function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/leads/lead-1/disposition', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('lead disposition route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest Dodson' })
    mocks.record.mockResolvedValue({ activityId: 'activity-1', appointmentId: null, projectionSynced: true })
  })

  it('rejects anonymous requests before parsing', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request({ disposition: 'no_answer' })
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req, params)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('uses the authenticated actor and ignores a client actor', async () => {
    const response = await POST(request({
      disposition: 'callback_requested',
      notes: 'Tomorrow morning',
      actor: 'Spoofed Agent',
    }), params)

    expect(response.status).toBe(201)
    expect(mocks.record).toHaveBeenCalledWith('lead-1', 'Ernest Dodson', expect.objectContaining({
      disposition: 'callback_requested',
      notes: 'Tomorrow morning',
    }))
  })

  it('refuses to invent appointment details', async () => {
    const response = await POST(request({ disposition: 'appointment_set' }), params)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'appointment_details_required' })
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
