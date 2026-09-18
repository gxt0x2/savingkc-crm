import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { mobileCommandPayloadHash, reserveMobileCommand } from './command-receipts'

const input = {
  actorEmail: 'casey@savingkc.com',
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  command: 'send_message',
  leadId: '22222222-2222-4222-8222-222222222222',
  payloadHash: mobileCommandPayloadHash({ body: 'Hello' }),
}

describe('mobile command receipts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const read = { maybeSingle: mocks.maybeSingle } as Record<string, unknown>
    read.eq = vi.fn(() => read)
    mocks.admin.mockReturnValue({
      from: () => ({ insert: mocks.insert, select: () => read }),
    })
  })

  it('reserves the first execution', async () => {
    mocks.insert.mockResolvedValue({ error: null })
    await expect(reserveMobileCommand(input)).resolves.toEqual({ kind: 'reserved' })
  })

  it('replays the stored result for the same actor, payload and key', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate' } })
    mocks.maybeSingle.mockResolvedValue({
      data: {
        actor_email: input.actorEmail, idempotency_key: input.idempotencyKey,
        command: input.command, lead_id: input.leadId, payload_hash: input.payloadHash,
        state: 'completed', http_status: 200, result: { sent: true },
      },
      error: null,
    })
    await expect(reserveMobileCommand(input)).resolves.toEqual({ kind: 'replay', status: 200, result: { sent: true } })
  })

  it('rejects reuse of a key for a different payload', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate' } })
    mocks.maybeSingle.mockResolvedValue({
      data: {
        actor_email: input.actorEmail, idempotency_key: input.idempotencyKey,
        command: input.command, lead_id: input.leadId, payload_hash: mobileCommandPayloadHash({ body: 'Different' }),
        state: 'pending', http_status: null, result: null,
      },
      error: null,
    })
    await expect(reserveMobileCommand(input)).resolves.toEqual({ kind: 'conflict' })
  })
})
