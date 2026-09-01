import type { DialerSessionState } from '@/lib/server/dialer-session-engine'

/** Provider work must finish well before the five-minute database operation hold. */
export const DIALER_PROVIDER_DEADLINE_MS = 60_000

export function dialerProviderSignal(
  request: Request,
  controlledSession: DialerSessionState | null,
  timeoutMs = DIALER_PROVIDER_DEADLINE_MS,
): AbortSignal | undefined {
  if (!controlledSession) return undefined
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > DIALER_PROVIDER_DEADLINE_MS) {
    throw new Error('Dialer provider deadline is invalid')
  }
  return AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)])
}

export function dialerProviderDeadlineExceeded(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false
  const reason = signal.reason
  return Boolean(reason && typeof reason === 'object' && 'name' in reason
    && (reason as { name?: unknown }).name === 'TimeoutError')
}
