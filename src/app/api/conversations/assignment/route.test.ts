import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

import { PATCH } from './route'

function request(assignedAgent: unknown) {
  return new Request('https://crm.savingkc.com/api/conversations/assignment', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: 'lead-1', assignedAgent }),
  })
}

describe('conversation assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'lead-1', assigned_agent: null }, error: null }),
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

  it('assigns the lead and records an audit activity', async () => {
    const response = await PATCH(request('casey'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.assignedAgent).toBe('Casey')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ assigned_agent: 'Casey' }))
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: 'lead-1',
      activity_type: 'status_change',
      metadata: expect.objectContaining({ hub_action: 'agent_assigned', assigned_agent: 'Casey' }),
    }))
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
})
