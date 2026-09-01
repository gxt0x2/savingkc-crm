import { supabase } from '@/lib/supabase-lazy'
import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import type {
  DialerAttemptState,
  DialerQueueSubject,
  DialerSessionError,
  DialerSessionState,
  DialerSessionStatus,
} from '@/lib/server/dialer-session-engine'

export interface DialerSessionControlSummary {
  sessionId: string
  campaignId: string | null
  campaignName: string
  status: DialerSessionStatus
  currentIndex: number
  queueSize: number
  controllerLabel: string | null
  heartbeatAt: string | null
  leaseExpiresAt: string | null
  generation: number
  stale: boolean
  attemptStatus: DialerAttemptState['status'] | null
  operationActive: boolean
  operationLabel: string | null
  operationExpiresAt: string | null
  canTakeOver: boolean
}

type DatabaseError = { message?: string; code?: string }

type DialerSessionErrorConstructor = new (
  code: string,
  status: number,
  message: string,
  details?: DialerSessionControlSummary,
) => DialerSessionError

type DialerSessionControlDependencies = {
  DialerSessionError: DialerSessionErrorConstructor
  getDialerSession: (actor: AuthenticatedActor, sessionId: string) => Promise<DialerSessionState>
  getOpenDialerSession: (actor: AuthenticatedActor) => Promise<DialerSessionState | null>
  isUuid: (value: unknown) => value is string
  mapDatabaseError: (error: DatabaseError | null | undefined) => DialerSessionError
  objectRecord: (value: unknown) => Record<string, unknown>
  parseDialerSession: (value: unknown) => DialerSessionState
}

export function createDialerSessionControl(dependencies: DialerSessionControlDependencies) {
  const {
    DialerSessionError,
    getDialerSession,
    getOpenDialerSession,
    isUuid,
    mapDatabaseError,
    objectRecord,
    parseDialerSession,
  } = dependencies

  async function getDialerSessionControlSummary(
    actor: AuthenticatedActor,
    sessionId: string,
  ): Promise<DialerSessionControlSummary> {
    const session = await getDialerSession(actor, sessionId)
    const [{ data: control, error: controlError }, { data: attempts, error: attemptError }] = await Promise.all([
      supabase
        .from('dialer_sessions')
        .select('controller_label,controller_heartbeat_at,controller_lease_expires_at,controller_generation,controller_operation_id,controller_operation_label,controller_operation_expires_at')
        .eq('id', session.id)
        .eq('actor_email', actor.email)
        .maybeSingle(),
      supabase
        .from('dialer_session_attempts')
        .select('status')
        .eq('session_id', session.id)
        .in('status', ['authorized', 'dialing', 'connected', 'awaiting_disposition'])
        .order('created_at', { ascending: false })
        .limit(1),
    ])
    if (controlError) throw mapDatabaseError(controlError)
    if (attemptError) throw mapDatabaseError(attemptError)
    if (!control) throw new DialerSessionError('session_not_found', 404, 'Dialer session not found')
    const controlRow = control as {
      controller_label: string | null
      controller_heartbeat_at: string | null
      controller_lease_expires_at: string | null
      controller_generation: number | null
      controller_operation_id: string | null
      controller_operation_label: string | null
      controller_operation_expires_at: string | null
    }
    const attemptStatus = ((attempts || [])[0] as { status?: DialerAttemptState['status'] } | undefined)?.status || null
    const campaignId = typeof session.settingsSnapshot.prospectingCampaignId === 'string'
      ? session.settingsSnapshot.prospectingCampaignId
      : null
    const campaignName = typeof session.settingsSnapshot.campaignName === 'string' && session.settingsSnapshot.campaignName.trim()
      ? session.settingsSnapshot.campaignName.trim()
      : session.queueKey.replace(/^campaign:/, '').replaceAll('_', ' ')
    const leaseExpiresAt = controlRow.controller_lease_expires_at
    const operationExpiresAt = controlRow.controller_operation_expires_at
    const operationActive = Boolean(
      controlRow.controller_operation_id
      && operationExpiresAt
      && Date.parse(operationExpiresAt) > Date.now(),
    )
    return {
      sessionId: session.id,
      campaignId,
      campaignName,
      status: session.status,
      currentIndex: session.currentIndex,
      queueSize: session.queueSize,
      controllerLabel: controlRow.controller_label,
      heartbeatAt: controlRow.controller_heartbeat_at,
      leaseExpiresAt,
      generation: Number(controlRow.controller_generation) || 0,
      stale: !leaseExpiresAt || Date.parse(leaseExpiresAt) <= Date.now(),
      attemptStatus,
      operationActive,
      operationLabel: operationActive ? controlRow.controller_operation_label : null,
      operationExpiresAt: operationActive ? operationExpiresAt : null,
      canTakeOver: attemptStatus === null && !operationActive,
    }
  }

  async function controlErrorWithSummary(
    error: DatabaseError,
    actor: AuthenticatedActor,
    sessionId: string,
  ): Promise<DialerSessionError> {
    const mapped = mapDatabaseError(error)
    if (!['session_control_conflict', 'session_control_lost', 'session_control_changed', 'session_takeover_live_call', 'session_takeover_disposition_required', 'session_takeover_operation_in_progress', 'session_control_operation_in_progress', 'session_control_operation_lost'].includes(mapped.code)) {
      return mapped
    }
    try {
      return new DialerSessionError(mapped.code, mapped.status, mapped.message, await getDialerSessionControlSummary(actor, sessionId))
    } catch {
      return mapped
    }
  }

  async function startDialerSession(input: {
    actor: AuthenticatedActor
    leadIds: string[]
    queueKey: string
    callerId: string
    savedQueueId?: string | null
    settings?: Record<string, unknown>
    controllerToken: string
    controllerLabel: string
  }): Promise<{ created: boolean; session: DialerSessionState }> {
    const leadIds = Array.from(new Set(input.leadIds.filter(isUuid).map((id) => id.trim())))
    if (leadIds.length < 1 || leadIds.length > 100 || leadIds.length !== input.leadIds.length) {
      throw new DialerSessionError('invalid_queue', 400, 'Select between 1 and 100 valid contacts')
    }
    if (input.savedQueueId && !isUuid(input.savedQueueId)) {
      throw new DialerSessionError('invalid_saved_queue', 400, 'Saved queue is invalid')
    }

    const queueItems: DialerQueueSubject[] = leadIds.map((id) => ({
      kind: 'lead', id, leadId: id, prospectId: null, campaignMemberId: null,
    }))
    const { data, error } = await supabase.rpc('start_dialer_session_v3', {
      p_actor_email: input.actor.email,
      p_agent_name: input.actor.name,
      p_queue_key: input.queueKey.trim() || 'custom',
      p_queue_items: queueItems,
      p_caller_id: input.callerId.trim(),
      p_saved_queue_id: input.savedQueueId || null,
      p_settings_snapshot: input.settings || {},
      p_controller_token: input.controllerToken,
      p_controller_label: input.controllerLabel,
    })
    if (error) {
      const open = await getOpenDialerSession(input.actor).catch(() => null)
      if (open) throw await controlErrorWithSummary(error, input.actor, open.id)
      throw mapDatabaseError(error)
    }
    const payload = data as { created?: unknown; session?: unknown } | null
    return { created: payload?.created === true, session: parseDialerSession(payload?.session) }
  }

  async function claimDialerSessionControl(input: {
    actor: AuthenticatedActor
    sessionId: string
    controllerToken: string
    controllerLabel: string
    force: boolean
    expectedGeneration?: number | null
    requestId?: string | null
  }): Promise<{ session: DialerSessionState; control: Record<string, unknown>; transferred: boolean }> {
    if (!isUuid(input.sessionId)) throw new DialerSessionError('invalid_session_id', 400, 'Dialer session is invalid')
    const { data, error } = await supabase.rpc('claim_dialer_session_control_v1', {
      p_session_id: input.sessionId,
      p_actor_email: input.actor.email,
      p_controller_token: input.controllerToken,
      p_controller_label: input.controllerLabel,
      p_force: input.force,
      p_expected_generation: input.expectedGeneration ?? null,
      p_request_id: input.requestId?.trim() || null,
    })
    if (error) throw await controlErrorWithSummary(error, input.actor, input.sessionId)
    const result = data as { session?: unknown; control?: unknown; transferred?: unknown } | null
    return {
      session: parseDialerSession(result?.session),
      control: objectRecord(result?.control),
      transferred: result?.transferred === true,
    }
  }

  async function heartbeatDialerSessionControl(input: {
    actor: AuthenticatedActor
    sessionId: string
    controllerToken: string
  }): Promise<{ session: DialerSessionState; control: Record<string, unknown> }> {
    if (!isUuid(input.sessionId)) throw new DialerSessionError('invalid_session_id', 400, 'Dialer session is invalid')
    const { data, error } = await supabase.rpc('heartbeat_dialer_session_control_v1', {
      p_session_id: input.sessionId,
      p_actor_email: input.actor.email,
      p_controller_token: input.controllerToken,
    })
    if (error) throw await controlErrorWithSummary(error, input.actor, input.sessionId)
    const result = data as { session?: unknown; control?: unknown } | null
    return { session: parseDialerSession(result?.session), control: objectRecord(result?.control) }
  }

  async function assertDialerSessionControl(input: {
    actor: AuthenticatedActor
    sessionId: string
    controllerToken: string
  }): Promise<void> {
    if (!isUuid(input.sessionId)) throw new DialerSessionError('invalid_session_id', 400, 'Dialer session is invalid')
    const { error } = await supabase.rpc('assert_dialer_session_control_v1', {
      p_session_id: input.sessionId,
      p_actor_email: input.actor.email,
      p_controller_token: input.controllerToken,
    })
    if (error) throw await controlErrorWithSummary(error, input.actor, input.sessionId)
  }

  async function beginDialerSessionControlOperation(input: {
    actor: AuthenticatedActor
    sessionId: string
    controllerToken: string
    operationId: string
    label: string
  }): Promise<Record<string, unknown>> {
    if (!isUuid(input.sessionId) || !isUuid(input.operationId)) {
      throw new DialerSessionError('invalid_dialer_operation', 400, 'Dialer operation is invalid')
    }
    const label = input.label.trim()
    if (!label || label.length > 120) {
      throw new DialerSessionError('invalid_dialer_operation', 400, 'Dialer operation is invalid')
    }
    const { data, error } = await supabase.rpc('begin_dialer_session_control_operation_v1', {
      p_session_id: input.sessionId,
      p_actor_email: input.actor.email,
      p_controller_token: input.controllerToken,
      p_operation_id: input.operationId,
      p_operation_label: label,
    })
    if (error) throw await controlErrorWithSummary(error, input.actor, input.sessionId)
    return objectRecord(data)
  }

  async function assertDialerSessionControlOperation(input: {
    actor: AuthenticatedActor
    sessionId: string
    controllerToken: string
    operationId: string
  }): Promise<void> {
    if (!isUuid(input.sessionId) || !isUuid(input.operationId)) {
      throw new DialerSessionError('invalid_dialer_operation', 400, 'Dialer operation is invalid')
    }
    const { error } = await supabase.rpc('assert_dialer_session_control_operation_v1', {
      p_session_id: input.sessionId,
      p_actor_email: input.actor.email,
      p_controller_token: input.controllerToken,
      p_operation_id: input.operationId,
    })
    if (error) throw await controlErrorWithSummary(error, input.actor, input.sessionId)
  }

  async function endDialerSessionControlOperation(input: {
    actor: AuthenticatedActor
    sessionId: string
    controllerToken: string
    operationId: string
  }): Promise<Record<string, unknown>> {
    if (!isUuid(input.sessionId) || !isUuid(input.operationId)) {
      throw new DialerSessionError('invalid_dialer_operation', 400, 'Dialer operation is invalid')
    }
    const { data, error } = await supabase.rpc('end_dialer_session_control_operation_v1', {
      p_session_id: input.sessionId,
      p_actor_email: input.actor.email,
      p_controller_token: input.controllerToken,
      p_operation_id: input.operationId,
    })
    if (error) throw await controlErrorWithSummary(error, input.actor, input.sessionId)
    return objectRecord(data)
  }

  return {
    assertDialerSessionControl,
    assertDialerSessionControlOperation,
    beginDialerSessionControlOperation,
    claimDialerSessionControl,
    controlErrorWithSummary,
    endDialerSessionControlOperation,
    getDialerSessionControlSummary,
    heartbeatDialerSessionControl,
    startDialerSession,
  }
}
