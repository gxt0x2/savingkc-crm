import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))

import { POST } from './route'

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/leads/create-appointment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('appointment command route trust boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects anonymous requests before parsing the body', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request({ leadId: 'lead-1' })
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
  })

  it('uses the authenticated actor when validating assignee authority', async () => {
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    const response = await POST(request({
      leadId: 'lead-1',
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      assignedTo: 'Fake Agent',
    }))
    expect(response.status).toBe(403)
  })
})
