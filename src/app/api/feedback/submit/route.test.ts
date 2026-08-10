import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { POST } from './route'

function request(overrides: Record<string, unknown> = {}) {
  return new Request('https://crm.savingkc.com/api/feedback/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      issue_kind: 'process',
      department: 'Acquisitions',
      category: 'Speed to lead',
      description: 'The revenue card did not load.',
      five_whys: ['The alert was delayed.', '', '', '', ''],
      priority: 'high',
      page_url: 'https://crm.savingkc.com/dashboard',
      user_agent: 'Browser test',
      ...overrides,
    }),
  })
}

describe('system Andon submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-ernest', email: 'ernest@savingkc.com' } } })
    mocks.from.mockReturnValue({
      insert: (payload: unknown) => {
        mocks.insert(payload)
        return {
          select: () => ({
            single: async () => ({ data: { id: 'andon-1' }, error: null }),
          }),
        }
      },
    })
  })

  it('records the signed-in agent instead of a hard-coded owner', async () => {
    const response = await POST(request() as never)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.feedback_id).toBe('andon-1')
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: 'user-ernest',
      agent_name: 'Ernest',
      issue_kind: 'process',
      department: 'Acquisitions',
      category: 'Speed to lead',
      section: 'Acquisitions · Speed to lead',
      status: 'open',
    }))
  })

  it('requires an authenticated CRM user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const response = await POST(request() as never)

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects invalid Andon payloads before writing', async () => {
    const response = await POST(request({ priority: 'everything is broken' }) as never)

    expect(response.status).toBe(400)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
