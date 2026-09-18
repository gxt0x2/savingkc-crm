import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), reserve: vi.fn(), complete: vi.fn(), admin: vi.fn(), insert: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileActor: mocks.actor,
}))
vi.mock('@/lib/mobile-api/command-receipts', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/command-receipts')>(), reserveMobileCommand: mocks.reserve, completeMobileCommand: mocks.complete,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
import { POST } from './route'

function request(body: Record<string, unknown>, key = 'call-result-1') {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/calls/events', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
  })
}

describe('mobile call outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'casey@savingkc.com', name: 'Casey' } })
    mocks.reserve.mockResolvedValue({ kind: 'reserved' })
    mocks.complete.mockResolvedValue(undefined)
    mocks.insert.mockImplementation((row) => ({ select: () => ({ single: async () => ({ data: { id: 'activity-1' }, error: null, row }) }) }))
    mocks.admin.mockReturnValue({
      from: (table: string) => table === 'lead_activities'
        ? { insert: mocks.insert }
        : { update: () => ({ eq: async () => ({ error: null }) }) },
    })
  })

  it('writes exactly one ended outcome with the server-derived actor', async () => {
    const response = await POST(request({
      leadId: 'lead-1', phone: '+18165550123', event: 'ended', durationSeconds: 42,
      outcome: 'answered', disposition: 'answered', note: 'Seller wants a follow-up.', clientCallId: 'client-call-1',
    }))
    expect(response.status).toBe(200)
    expect(mocks.insert).toHaveBeenCalledTimes(1)
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({
      lead_id: 'lead-1', activity_type: 'call', agent: 'Casey',
      metadata: { event: 'ended', outcome: 'answered', duration: 42, actor_email: 'casey@savingkc.com' },
    })
    expect(mocks.complete).toHaveBeenCalledTimes(1)
  })

  it('rejects a started event so the app cannot create duplicate call rows', async () => {
    const response = await POST(request({ leadId: 'lead-1', phone: '+18165550123', event: 'started', clientCallId: 'client-call-1' }))
    expect(response.status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('replays a completed outcome without inserting again', async () => {
    mocks.reserve.mockResolvedValue({ kind: 'replay', status: 200, result: { ok: true, activityId: 'activity-1' } })
    const response = await POST(request({ leadId: 'lead-1', phone: '+18165550123', event: 'ended', outcome: 'voicemail', clientCallId: 'client-call-1' }))
    expect(response.status).toBe(200)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
