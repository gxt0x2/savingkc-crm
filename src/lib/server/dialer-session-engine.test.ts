import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))

import {
  DialerSessionError,
  parseDialerSession,
  startDialerSession,
} from './dialer-session-engine'

const leadId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000010'

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    status: 'active',
    actorEmail: 'casey@savingkc.com',
    agentName: 'Casey',
    queueKey: 'cold_prospecting',
    savedQueueId: null,
    leadIds: [leadId],
    queueSize: 1,
    currentIndex: 0,
    currentLeadId: leadId,
    callerId: '+18167277667',
    dialsCompleted: 0,
    contacts: 0,
    skips: 0,
    startedAt: '2026-08-20T12:00:00.000Z',
    pausedAt: null,
    endedAt: null,
    updatedAt: '2026-08-20T12:00:00.000Z',
    stateVersion: 1,
    ...overrides,
  }
}

describe('durable dialer session engine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects invalid or duplicate queue identities before database work', async () => {
    await expect(startDialerSession({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      leadIds: [leadId, leadId],
      queueKey: 'custom',
      callerId: '+18167277667',
    })).rejects.toMatchObject({ code: 'invalid_queue', status: 400 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('starts an actor-owned one-line session through the transactional RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: { created: true, session: session() }, error: null })

    const result = await startDialerSession({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      leadIds: [leadId],
      queueKey: 'cold_prospecting',
      callerId: '+18167277667',
      settings: { ringCount: 4 },
    })

    expect(result.created).toBe(true)
    expect(result.session.currentLeadId).toBe(leadId)
    expect(mocks.rpc).toHaveBeenCalledWith('start_dialer_session_v1', expect.objectContaining({
      p_actor_email: 'casey@savingkc.com',
      p_agent_name: 'Casey',
      p_lead_ids: [leadId],
      p_caller_id: '+18167277667',
      p_settings_snapshot: { ringCount: 4 },
    }))
  })

  it('fails closed when the database contract is not installed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function does not exist' } })

    await expect(startDialerSession({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      leadIds: [leadId],
      queueKey: 'custom',
      callerId: '+18167277667',
    })).rejects.toMatchObject({ code: 'session_engine_unavailable', status: 503 })
  })

  it('rejects malformed database payloads instead of inventing client state', () => {
    expect(() => parseDialerSession({ ...session(), leadIds: 'not-an-array' })).toThrow(DialerSessionError)
    expect(() => parseDialerSession({ ...session(), queueSize: 2 })).toThrow(DialerSessionError)
    expect(() => parseDialerSession({ ...session(), status: 'mystery' })).toThrow(DialerSessionError)
  })
})
