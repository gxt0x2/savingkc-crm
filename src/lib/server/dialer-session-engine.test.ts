import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))

import {
  advanceDialerSessionAfterDisposition,
  assertDialerSessionControl,
  assertDialerSessionControlOperation,
  authorizeDialerSessionAttempt,
  beginDialerSessionControlOperation,
  claimDialerSessionControl,
  DialerSessionError,
  endDialerSessionControlOperation,
  getDialerSessionHistory,
  heartbeatDialerSessionControl,
  parseDialerSession,
  requestPauseDialerSession,
  startDialerSession,
  transitionDialerAttempt,
  transitionDialerSession,
} from './dialer-session-engine'

const leadId = '00000000-0000-4000-8000-000000000001'
const sessionId = '00000000-0000-4000-8000-000000000010'
const controllerToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

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
    lastInteractionAt: '2026-08-20T12:00:00.000Z',
    idleExpiresAt: '2026-08-20T12:05:00.000Z',
    idleTimedOutAt: null,
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
      controllerToken: '10000000-0000-4000-8000-000000000001',
      controllerLabel: 'Chrome on Mac',
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
      controllerToken: '10000000-0000-4000-8000-000000000001',
      controllerLabel: 'Chrome on Mac',
    })

    expect(result.created).toBe(true)
    expect(result.session.currentLeadId).toBe(leadId)
    expect(mocks.rpc).toHaveBeenCalledWith('start_dialer_session_v3', expect.objectContaining({
      p_actor_email: 'casey@savingkc.com',
      p_agent_name: 'Casey',
      p_queue_items: [{ kind: 'lead', id: leadId, leadId, prospectId: null, campaignMemberId: null }],
      p_caller_id: '+18167277667',
      p_settings_snapshot: { ringCount: 4 },
      p_controller_token: '10000000-0000-4000-8000-000000000001',
      p_controller_label: 'Chrome on Mac',
    }))
  })

  it('fails closed when the database contract is not installed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function does not exist' } })

    await expect(startDialerSession({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      leadIds: [leadId],
      queueKey: 'custom',
      callerId: '+18167277667',
      controllerToken: '10000000-0000-4000-8000-000000000001',
      controllerLabel: 'Chrome on Mac',
    })).rejects.toMatchObject({ code: 'session_engine_unavailable', status: 503 })
  })

  it('requests a durable pause without losing an unfinished outcome', async () => {
    mocks.rpc.mockResolvedValue({
      data: { session: session({ status: 'paused', pausedAt: '2026-08-25T23:00:00.000Z' }), requiresDisposition: true },
      error: null,
    })

    const result = await requestPauseDialerSession({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      sessionId,
      controllerToken,
      reason: 'Agent paused the calling session',
    })

    expect(result.session.status).toBe('paused')
    expect(result.requiresDisposition).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('request_pause_dialer_session_v2', {
      p_session_id: sessionId,
      p_actor_email: 'casey@savingkc.com',
      p_controller_token: controllerToken,
      p_reason: 'Agent paused the calling session',
    })
  })

  it('claims and renews a controller lease without exposing its token in returned state', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { session: session(), control: { controllerLabel: 'Chrome on Mac', generation: 2 }, transferred: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { session: session(), control: { controllerLabel: 'Chrome on Mac', generation: 2 } },
        error: null,
      })

    const claim = await claimDialerSessionControl({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      sessionId,
      controllerToken,
      controllerLabel: 'Chrome on Mac',
      force: true,
      expectedGeneration: 1,
      requestId: 'takeover-1',
    })
    const heartbeat = await heartbeatDialerSessionControl({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      sessionId,
      controllerToken,
    })

    expect(claim.transferred).toBe(true)
    expect(claim.control).toEqual({ controllerLabel: 'Chrome on Mac', generation: 2 })
    expect(heartbeat.control).toEqual({ controllerLabel: 'Chrome on Mac', generation: 2 })
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'claim_dialer_session_control_v1', {
      p_session_id: sessionId,
      p_actor_email: 'casey@savingkc.com',
      p_controller_token: controllerToken,
      p_controller_label: 'Chrome on Mac',
      p_force: true,
      p_expected_generation: 1,
      p_request_id: 'takeover-1',
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'heartbeat_dialer_session_control_v2', {
      p_session_id: sessionId,
      p_actor_email: 'casey@savingkc.com',
      p_controller_token: controllerToken,
      p_user_active: false,
    })
  })

  it('begins, verifies, and ends a bounded CRM operation under the controller lease', async () => {
    const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    mocks.rpc
      .mockResolvedValueOnce({ data: { control: { operationActive: true } }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { control: { operationActive: false } }, error: null })
    const actor = { email: 'casey@savingkc.com', name: 'Casey' }

    await beginDialerSessionControlOperation({
      actor,
      sessionId,
      controllerToken,
      operationId,
      label: 'Saving contact note',
    })
    await assertDialerSessionControlOperation({ actor, sessionId, controllerToken, operationId })
    await endDialerSessionControlOperation({ actor, sessionId, controllerToken, operationId })

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'begin_dialer_session_control_operation_v1', {
      p_session_id: sessionId,
      p_actor_email: actor.email,
      p_controller_token: controllerToken,
      p_operation_id: operationId,
      p_operation_label: 'Saving contact note',
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'assert_dialer_session_control_operation_v1', {
      p_session_id: sessionId,
      p_actor_email: actor.email,
      p_controller_token: controllerToken,
      p_operation_id: operationId,
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, 'end_dialer_session_control_operation_v1', {
      p_session_id: sessionId,
      p_actor_email: actor.email,
      p_controller_token: controllerToken,
      p_operation_id: operationId,
    })
  })

  it('uses controller-enforcing wrappers for every session and attempt mutation', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: session({ status: 'paused' }), error: null })
      .mockResolvedValueOnce({ data: { id: 'attempt-row', status: 'authorized' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'attempt-row', status: 'dialing' }, error: null })
      .mockResolvedValueOnce({ data: session(), error: null })

    const actor = { email: 'casey@savingkc.com', name: 'Casey' }
    await assertDialerSessionControl({ actor, sessionId, controllerToken })
    await transitionDialerSession({ actor, sessionId, controllerToken, action: 'pause', reason: 'Agent pause' })
    await authorizeDialerSessionAttempt({
      actor,
      sessionId,
      controllerToken,
      clientAttemptId: 'attempt-1',
      subjectKind: 'lead',
      subjectId: leadId,
      campaignMemberId: null,
      leadId,
      prospectId: null,
      prospectPhoneId: null,
      phone: '+19135550123',
      callerId: '+18163100845',
    })
    await transitionDialerAttempt({
      actor,
      sessionId,
      controllerToken,
      clientAttemptId: 'attempt-1',
      action: 'started',
    })
    await advanceDialerSessionAfterDisposition({ actor, sessionId, controllerToken, clientAttemptId: 'attempt-1' })

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'assert_dialer_session_control_v1', {
      p_session_id: sessionId,
      p_actor_email: actor.email,
      p_controller_token: controllerToken,
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'transition_dialer_session_v2', expect.objectContaining({
      p_controller_token: controllerToken,
      p_action: 'pause',
    }))
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, 'authorize_dialer_attempt_v4', expect.objectContaining({
      p_controller_token: controllerToken,
      p_client_attempt_id: 'attempt-1',
    }))
    expect(mocks.rpc).toHaveBeenNthCalledWith(4, 'transition_dialer_attempt_v2', expect.objectContaining({
      p_controller_token: controllerToken,
      p_action: 'started',
    }))
    expect(mocks.rpc).toHaveBeenNthCalledWith(5, 'advance_dialer_session_v2', {
      p_session_id: sessionId,
      p_actor_email: actor.email,
      p_controller_token: controllerToken,
      p_client_attempt_id: 'attempt-1',
    })
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
      last_interaction_at: item.lastInteractionAt,
      idle_timeout_seconds: 300,
      idle_timed_out_at: item.idleTimedOutAt,
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
