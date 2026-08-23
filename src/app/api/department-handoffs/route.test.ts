import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), admin: vi.fn(), accept: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/server/crm-operating-handoffs', () => ({ acceptDepartmentHandoff: mocks.accept }))

import { GET, PATCH } from './route'

describe('department handoff API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects anonymous reads before database access', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/department-handoffs?department=dispositions'))
    expect(response.status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('ignores client actor data and accepts with the verified server actor', async () => {
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.accept.mockResolvedValue({ handoffId: '11111111-1111-4111-8111-111111111111', status: 'accepted', replayed: false })
    const response = await PATCH(new NextRequest('https://crm.savingkc.com/api/department-handoffs', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handoffId: '11111111-1111-4111-8111-111111111111', action: 'accept', actor: 'Spoofed' }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith({
      handoffId: '11111111-1111-4111-8111-111111111111', actorEmail: 'casey@savingkc.com', actorName: 'Casey',
    })
  })
})
