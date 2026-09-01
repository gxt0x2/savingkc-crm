import { NextResponse } from 'next/server'

import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import { dialerControllerFromRequest } from '@/lib/api/dialer-controller'
import {
  assertDialerSessionControlOperation,
  DialerSessionError,
  getDialerSession,
  getOpenDialerSession,
  type DialerSessionState,
} from '@/lib/server/dialer-session-engine'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

export interface DialerMutationSubject {
  leadId?: unknown
  prospectId?: unknown
  campaignMemberId?: unknown
}

interface DialerMutationControlInput {
  request: Request
  actor: AuthenticatedActor
  sessionId: unknown
  subject: DialerMutationSubject
  required?: boolean
  protectMatchingOpenSession?: boolean
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function comesFromProspecting(request: Request): boolean {
  const referrer = request.headers.get('referer')
  if (!referrer) return false
  try {
    const source = new URL(referrer)
    const destination = new URL(request.url)
    return source.origin === destination.origin
      && (source.pathname === '/prospecting' || source.pathname.startsWith('/prospecting/'))
  } catch {
    return false
  }
}

function sessionMatchesSubject(session: DialerSessionState, subject: DialerMutationSubject): boolean {
  const leadId = text(subject.leadId)
  const prospectId = text(subject.prospectId)
  const campaignMemberId = text(subject.campaignMemberId)
  const subjectMatches = session.currentSubjectKind === 'lead'
    ? session.currentSubjectId === leadId
    : session.currentSubjectId === prospectId
  const memberMatches = !campaignMemberId || session.currentCampaignMemberId === campaignMemberId
  return (subjectMatches || (!leadId && !prospectId && Boolean(campaignMemberId) && campaignMemberId === session.currentCampaignMemberId))
    && memberMatches
}

function controlRequired(message: string) {
  return new DialerSessionError('dialer_session_control_required', 409, message)
}

export async function assertDialerMutationControl({
  request,
  actor,
  sessionId: rawSessionId,
  subject,
  required = false,
  protectMatchingOpenSession = false,
}: DialerMutationControlInput): Promise<DialerSessionState | null> {
  const sessionId = text(rawSessionId)
  const carriesDialerAuthority = Boolean(
    request.headers.get('x-dialer-controller')
    || request.headers.get('x-dialer-operation'),
  )

  if (!sessionId) {
    if (required || carriesDialerAuthority || (protectMatchingOpenSession && comesFromProspecting(request))) {
      throw controlRequired('This action requires the active Prospecting dialing session. Refresh and try again.')
    }
    if (protectMatchingOpenSession) {
      const openSession = await getOpenDialerSession(actor)
      if (openSession && sessionMatchesSubject(openSession, subject)) {
        throw controlRequired('This record is active in Prospecting. Use the window that owns the dialing session.')
      }
    }
    return null
  }

  if (!UUID_PATTERN.test(sessionId)) {
    throw new DialerSessionError('invalid_session_id', 400, 'Dialer session is invalid')
  }
  const controller = dialerControllerFromRequest(request)
  if (!controller) {
    throw new DialerSessionError(
      'invalid_dialer_controller',
      400,
      'This browser could not identify its dialing controls. Refresh and try again.',
    )
  }
  const operationId = request.headers.get('x-dialer-operation')?.trim() || ''
  if (!UUID_PATTERN.test(operationId)) {
    throw new DialerSessionError(
      'dialer_operation_required',
      409,
      'This dialing action is no longer authorized. Refresh the session and try again.',
    )
  }

  const session = await getDialerSession(actor, sessionId)
  if (!sessionMatchesSubject(session, subject)) {
    throw new DialerSessionError(
      'session_context_mismatch',
      409,
      'This record no longer matches the active dialing session.',
    )
  }
  await assertDialerSessionControlOperation({
    actor,
    sessionId,
    controllerToken: controller.token,
    operationId,
  })
  return session
}

export function dialerMutationControlErrorResponse(error: unknown, extra?: Record<string, unknown>) {
  if (!(error instanceof DialerSessionError)) return null
  return NextResponse.json(
    { ...extra, error: error.message, code: error.code, details: error.details },
    { status: error.status, headers: NO_STORE },
  )
}
