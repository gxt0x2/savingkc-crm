import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEAD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const COMMAND_ID = '11111111-1111-4111-8111-111111111111'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))

import { POST } from './route'

const context = { params: Promise.resolve({ id: LEAD_ID }) }

function request(body: unknown, commandId = COMMAND_ID) {
  return new Request(`https://crm.savingkc.com/api/leads/${LEAD_ID}/offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId },
    body: JSON.stringify(body),
  })
}

function commandResult(replayed = false) {
  return {
    data: {
      amount: 125000,
      stage: 'offer_made',
      replayed,
      activity: {
        id: 'activity-1',
        activity_type: 'offer',
        description: 'Written offer made: $125,000',
        agent: 'Casey',
        metadata: { source: 'canonical_offer_v1' },
        created_at: '2026-08-24T12:00:00.000Z',
      },
    },
    error: null,
  }
}

describe('lead offer command route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.rpc.mockResolvedValue(commandResult())
  })

  it('rejects anonymous requests before reading the body or touching CRM data', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request({ amount: 125000, method: 'written' })
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req, context)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('records the offer atomically with the verified actor and idempotency key', async () => {
    const response = await POST(request({
      amount: '$125,000',
      method: 'written',
      notes: ' Seller asked for a Friday answer ',
      actor: 'Spoofed Operator',
    }), context)

    expect(response.status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledWith('record_crm_lead_offer_v1', {
      target_lead_id: LEAD_ID,
      target_command_id: COMMAND_ID,
      target_amount: 125000,
      target_method: 'written',
      target_notes: 'Seller asked for a Friday answer',
      target_actor_email: 'casey@savingkc.com',
      target_actor_name: 'Casey',
    })
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      replayed: false,
      offer: { amount: 125000, station: 'offer_made', recordedBy: 'Casey' },
    })
  })

  it('returns the previously recorded offer for an idempotent replay', async () => {
    mocks.rpc.mockResolvedValue(commandResult(true))

    const response = await POST(request({ amount: 125000, method: 'written' }), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ replayed: true })
  })

  it('returns a conflict for terminal contacts without leaking database details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'terminal_lead_cannot_receive_offer' } })

    const response = await POST(request({ amount: 125000, method: 'verbal' }), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Reopen this contact before recording an offer.' })
  })

  it('rejects non-UUID idempotency keys before invoking the command', async () => {
    const response = await POST(request({ amount: 125000, method: 'verbal' }, 'retry-this-offer'), context)

    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
