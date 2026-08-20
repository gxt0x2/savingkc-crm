import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  resolveAuthenticatedActor: vi.fn(),
}))

const LEAD_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

import { PATCH } from './route'

function request(assignedAgent: unknown, actor: unknown = 'Spoofed Agent', leadId = LEAD_ID) {
  return new Request('https://crm.savingkc.com/api/conversations/assignment', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, assignedAgent, actor }),
  })
}

describe('conversation assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: LEAD_ID, assigned_agent: null }, error: null }),
            }),
          }),
          update: (payload: unknown) => {
            mocks.update(payload)
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      return {
        insert: async (payload: unknown) => {
          mocks.insert(payload)
          return { error: null }
        },
      }
    })
  })

  it('assigns the lead and attributes the audit to Casey instead of a spoofed actor', async () => {
    const response = await PATCH(request('casey'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.assignedAgent).toBe('Casey')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ assigned_agent: 'Casey' }))
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: LEAD_ID,
      activity_type: 'status_change',
      agent: 'Casey',
      metadata: expect.objectContaining({ hub_action: 'agent_assigned', assigned_agent: 'Casey' }),
    }))
  })

  it('denies unauthenticated assignment before touching lead data', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)

    const response = await PATCH(request('casey'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('assigns Gertha as an operating-team agent', async () => {
    const response = await PATCH(request('gertha'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.assignedAgent).toBe('Gertha')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ assigned_agent: 'Gertha' }))
  })

  it('returns the lead to the team queue', async () => {
    const response = await PATCH(request(null))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.assignedAgent).toBeNull()
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ assigned_agent: null }))
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ hub_action: 'agent_unassigned' }),
    }))
  })

  it('rejects agents outside the operating team', async () => {
    const response = await PATCH(request('Someone else'))
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects malformed lead ids before touching lead data', async () => {
    const response = await PATCH(request('casey', 'Spoofed Agent', 'not-a-lead-id'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ success: false, error: 'A valid leadId is required' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
