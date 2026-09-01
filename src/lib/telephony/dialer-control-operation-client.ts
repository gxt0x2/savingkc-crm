'use client'

import {
  dialerControllerHeaders,
  newDialerControlRequestId,
} from '@/lib/telephony/dialer-controller-client'

const CONTROL_LOSS_CODES = new Set([
  'session_control_changed',
  'session_control_conflict',
  'session_control_lost',
])
const OPERATION_RENEWAL_INTERVAL_MS = 30_000
const OPERATION_RENEWAL_TIMEOUT_MS = 10_000
const NO_WORK_ERROR = Symbol('no-work-error')
export const DIALER_CONTROL_LOSS_OPERATION_HOLD = 'operation_hold'

export class DialerOperationHoldRetainedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DialerOperationHoldRetainedError'
  }
}

type OperationErrorPayload = {
  code?: string
  error?: string
}

class OperationRequestRejectedError extends Error {}

function isFailedResponse(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'ok' in value && (value as { ok?: unknown }).ok === false)
}

function isOperationUncertainResponse(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('headers' in value)) return false
  const headers = (value as { headers?: { get?: (name: string) => string | null } }).headers
  return headers?.get?.('X-Dialer-Operation-Uncertain')?.toLowerCase() === 'true'
}

function isAbortError(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'name' in value && (value as { name?: unknown }).name === 'AbortError')
}

function withRenewalDeadline(request: Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('The dialing-control renewal timed out.'))
    }, OPERATION_RENEWAL_TIMEOUT_MS)
    request.then(
      () => {
        window.clearTimeout(timeout)
        resolve()
      },
      (error: unknown) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function dispatchTerminalOperationHoldLoss(sessionId: string, message: string): void {
  window.dispatchEvent(new CustomEvent('dialer-control-lost', {
    detail: {
      sessionId,
      reason: DIALER_CONTROL_LOSS_OPERATION_HOLD,
      terminal: true,
      message,
    },
  }))
}

async function operationRequest(input: {
  sessionId: string
  method: 'POST' | 'PATCH' | 'DELETE'
  controllerHeaders: Record<string, string>
  operationId: string
  label?: string
}): Promise<void> {
  const response = await fetch(
    `/api/dialer/sessions/${encodeURIComponent(input.sessionId)}/control/operations`,
    {
      method: input.method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...input.controllerHeaders },
      body: JSON.stringify({
        operationId: input.operationId,
        ...(input.label ? { label: input.label } : {}),
      }),
    },
  )
  const payload = await response.json().catch(() => null) as OperationErrorPayload | null
  if (response.ok) return

  if (input.method === 'POST' && payload?.code && CONTROL_LOSS_CODES.has(payload.code)) {
    window.dispatchEvent(new CustomEvent('dialer-control-lost', {
      detail: { sessionId: input.sessionId },
    }))
  }
  throw new OperationRequestRejectedError(payload?.error || 'Dialing-session control is unavailable. Check the other window and try again.')
}

/**
 * Keeps a Dialer-scoped CRM mutation under the same browser controller from
 * start through server acknowledgement. A successful begin blocks takeover
 * until the matching end request (or the server TTL) releases the operation.
 */
export async function withDialerSessionControlOperation<T>(
  sessionId: string | null | undefined,
  label: string,
  work: (headers: Record<string, string>, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const normalizedSessionId = sessionId?.trim() || ''
  if (!normalizedSessionId) return work({}, new AbortController().signal)

  const controllerHeaders = await dialerControllerHeaders()
  const operationId = newDialerControlRequestId()
  const beginInput = {
    sessionId: normalizedSessionId,
    method: 'POST' as const,
    controllerHeaders,
    operationId,
    label,
  }
  try {
    await operationRequest(beginInput)
  } catch (firstError) {
    if (firstError instanceof OperationRequestRejectedError) throw firstError
    try {
      await operationRequest(beginInput)
    } catch (retryError) {
      const detail = retryError instanceof Error ? retryError.message : 'begin request failed'
      const error = new Error(`Dialing control could not confirm that the CRM change hold started. ${detail}`)
      dispatchTerminalOperationHoldLoss(normalizedSessionId, error.message)
      throw error
    }
  }

  let stopped = false
  let renewalInFlight: Promise<void> | null = null
  let renewalError: Error | null = null
  const readRenewalError = (): Error | null => renewalError
  const workAbort = new AbortController()
  const renewalTimer = window.setInterval(() => {
    if (stopped || renewalError || renewalInFlight) return
    renewalInFlight = withRenewalDeadline(operationRequest({
      sessionId: normalizedSessionId,
      method: 'PATCH',
      controllerHeaders,
      operationId,
    })).catch((error: unknown) => {
      if (stopped) return
      const detail = error instanceof Error ? error.message : 'renewal failed'
      renewalError = new Error(`Dialing control could not be renewed. ${detail}`)
      workAbort.abort(renewalError)
      dispatchTerminalOperationHoldLoss(normalizedSessionId, renewalError.message)
    }).finally(() => {
      renewalInFlight = null
    })
  }, OPERATION_RENEWAL_INTERVAL_MS)

  let result!: T
  let workError: unknown | typeof NO_WORK_ERROR = NO_WORK_ERROR
  try {
    result = await work({
      ...controllerHeaders,
      'X-Dialer-Operation': operationId,
    }, workAbort.signal)
  } catch (error) {
    workError = error
  }
  stopped = true
  window.clearInterval(renewalTimer)
  if (renewalInFlight) await renewalInFlight
  const finalRenewalError = readRenewalError()
  const retainHoldError = workError instanceof DialerOperationHoldRetainedError ? workError : null
  const uncertainResponse = workError === NO_WORK_ERROR && isOperationUncertainResponse(result)
  const workOutcomeUncertain = workError !== NO_WORK_ERROR || uncertainResponse

  let cleanupError: unknown | typeof NO_WORK_ERROR = NO_WORK_ERROR
  if (!finalRenewalError && !workOutcomeUncertain) {
    try {
      await operationRequest({
        sessionId: normalizedSessionId,
        method: 'DELETE',
        controllerHeaders,
        operationId,
      })
    } catch (error) {
      cleanupError = error
      const detail = error instanceof Error ? error.message : 'release failed'
      dispatchTerminalOperationHoldLoss(
        normalizedSessionId,
        `Dialing control could not confirm that the CRM change hold was released. ${detail}`,
      )
    }
  }

  if (workOutcomeUncertain && !finalRenewalError) {
    dispatchTerminalOperationHoldLoss(
      normalizedSessionId,
      retainHoldError?.message
        || (uncertainResponse
          ? 'The provider did not confirm the CRM change outcome. Do not retry; reload after the safety hold expires.'
          : null)
        || 'The CRM change did not return a confirmed result. Reload after the safety hold expires before dialing.',
    )
  }

  if (workError !== NO_WORK_ERROR) {
    if (finalRenewalError && (workError === workAbort.signal.reason || isAbortError(workError))) throw finalRenewalError
    throw workError
  }
  if (isFailedResponse(result)) return result
  if (finalRenewalError) {
    throw new Error(`The change may have been saved, but dialing control could not be renewed. ${finalRenewalError.message}`)
  }
  if (cleanupError !== NO_WORK_ERROR) {
    const detail = cleanupError instanceof Error ? cleanupError.message : 'release failed'
    throw new Error(`The change was saved, but dialing control could not be released. ${detail}`)
  }
  return result
}
