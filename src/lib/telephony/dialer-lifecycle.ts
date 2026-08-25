export type PostDispositionCommand = 'advance_number' | 'pause_session' | 'stop_session'

export function postDispositionCommand(stopRequested: boolean, pauseRequested = false): PostDispositionCommand {
  if (stopRequested) return 'stop_session'
  if (pauseRequested) return 'pause_session'
  return 'advance_number'
}

export function dialerStopIsPending(
  sessionId: string | null | undefined,
  stopRequestedSessionId: string | null | undefined,
): boolean {
  return Boolean(sessionId && sessionId === stopRequestedSessionId)
}

export function dialerPauseIsPending(
  sessionId: string | null | undefined,
  pausedSessionId: string | null | undefined,
): boolean {
  return Boolean(sessionId && sessionId === pausedSessionId)
}
