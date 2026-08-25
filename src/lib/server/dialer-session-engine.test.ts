import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))

import {
  DialerSessionError,
  getDialerSessionHistory,
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
    queueItems: [{ kind: 'lead', id: leadId, leadId, prospectId: null, campaignMemberId: null }],
    queueSize: 1,
    currentIndex: 0,
    currentLeadId: leadId,
    currentProspectId: null,
    currentSubjectKind: 'lead',
    currentSubjectId: leadId,
    currentCampaignMemberId: null,
    callerId: '+18167277667',
    dialsCompleted: 0,
    contacts: 0,
    skips: 0,
    outcomes: {},
    startedAt: '2026-08-20T12:00:00.000Z',
    pausedAt: null,
    stopRequestedAt: null,
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
    expect(mocks.rpc).toHaveBeenCalledWith('start_dialer_session_v2', expect.objectContaining({
      p_actor_email: 'casey@savingkc.com',
      p_agent_name: 'Casey',
      p_queue_items: [{ kind: 'lead', id: leadId, leadId, prospectId: null, campaignMemberId: null }],
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
    expect(() => parseDialerSession({ ...session(), leadIds: 'not-an-array', queueItems: 'not-an-array' })).toThrow(DialerSessionError)
    expect(() => parseDialerSession({ ...session(), queueSize: 2 })).toThrow(DialerSessionError)
    expect(() => parseDialerSession({ ...session(), status: 'mystery' })).toThrow(DialerSessionError)
  })

  it('reads only the verified actor history with a capped keyset page', async () => {
    const rows = [
      session({ id: sessionId, outcomes: { answered: 1 }, updatedAt: '2026-08-20T12:00:00.123456Z' }),
      session({ id: '00000000-0000-4000-8000-000000000011', updatedAt: '2026-08-20T11:00:00.123456Z' }),
    ].map((item) => ({
      id: item.id,
      status: item.status,
      actor_email: item.actorEmail,
      agent_name: item.agentName,
      queue_key: item.queueKey,
      saved_queue_id: item.savedQueueId,
      queue_snapshot: item.leadIds,
      queue_size: item.queueSize,
      current_index: item.currentIndex,
      current_lead_id: item.currentLeadId,
      current_prospect_id: item.currentProspectId,
      current_subject_kind: item.currentSubjectKind,
      current_subject_id: item.currentSubjectId,
      current_campaign_member_id: item.currentCampaignMemberId,
      caller_id: item.callerId,
      dials_completed: item.dialsCompleted,
      contacts: item.contacts,
      skips: item.skips,
      outcomes: item.outcomes || {},
      started_at: item.startedAt,
      paused_at: item.pausedAt,
      stop_requested_at: item.stopRequestedAt,
      ended_at: item.endedAt,
      updated_at: item.updatedAt,
      state_version: item.stateVersion,
    }))
    const query: Record<string, unknown> = { data: rows, error: null }
    for (const method of ['select', 'eq', 'order', 'limit', 'or']) query[method] = vi.fn(() => query)
    mocks.from.mockReturnValue(query)

    const page = await getDialerSessionHistory(
      { email: 'Casey@SavingKC.com', name: 'Casey' },
      { limit: 1 },
    )

    expect(mocks.from).toHaveBeenCalledWith('dialer_sessions')
    expect(query.eq).toHaveBeenCalledWith('actor_email', 'casey@savingkc.com')
    expect(query.limit).toHaveBeenCalledWith(2)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].outcomes).toEqual({ answered: 1 })
    expect(page.pageInfo).toMatchObject({ hasMore: true, limit: 1 })
    expect(JSON.parse(Buffer.from(page.pageInfo.nextCursor!, 'base64url').toString('utf8'))).toMatchObject({
      timestamp: '2026-08-20T12:00:00.123456Z',
      id: sessionId,
    })
  })

  it('rejects malformed history cursors before database work', async () => {
    await expect(getDialerSessionHistory(
      { email: 'casey@savingkc.com', name: 'Casey' },
      { cursor: 'not-a-cursor' },
    )).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
