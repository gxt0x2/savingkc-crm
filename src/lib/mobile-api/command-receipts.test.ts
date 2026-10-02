import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))

import { completeMobileCommand, mobileCommandIdentityUuid, reserveMobileCommand } from './command-receipts'

const claim = {
  actorEmail: 'casey@savingkc.com', idempotencyKey: 'stable-note-key', command: 'add_note',
  leadId: '11111111-1111-4111-8111-111111111111', payloadHash: 'a'.repeat(64),
}

describe('mobile command receipt fencing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reuses one activity identity for a retry and isolates actors and commands', () => {
    const id = mobileCommandIdentityUuid(claim.actorEmail, claim.idempotencyKey, claim.command)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(mobileCommandIdentityUuid(claim.actorEmail.toUpperCase(), claim.idempotencyKey, claim.command)).toBe(id)
    expect(mobileCommandIdentityUuid('ernest@savingkc.com', claim.idempotencyKey, claim.command)).not.toBe(id)
    expect(mobileCommandIdentityUuid(claim.actorEmail, claim.idempotencyKey, 'upload_message_attachment')).not.toBe(id)
  })

  it('passes stable payload binding to the database and accepts a recovered lease', async () => {
    mocks.rpc.mockResolvedValue({ data: { kind: 'recovered', token: 'lease-2', plan: null }, error: null })
    await expect(reserveMobileCommand(claim)).resolves.toEqual({ kind: 'recovered', token: 'lease-2', plan: null })
    expect(mocks.rpc).toHaveBeenCalledWith('claim_mobile_command_v2', expect.objectContaining({
      p_actor_email: claim.actorEmail, p_idempotency_key: claim.idempotencyKey,
      p_command: claim.command, p_lead_id: claim.leadId, p_payload_hash: claim.payloadHash,
      p_lease_token: expect.any(String),
    }))
  })

  it('refuses to acknowledge a result after another worker takes the lease', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    await expect(completeMobileCommand({ actorEmail: claim.actorEmail, idempotencyKey: claim.idempotencyKey,
      token: 'old-lease', status: 201, result: { success: true } })).rejects.toThrow('superseded')
  })
})
