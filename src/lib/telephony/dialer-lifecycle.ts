export type PostDispositionCommand = 'advance_number' | 'stop_session'

export function postDispositionCommand(stopRequested: boolean): PostDispositionCommand {
  return stopRequested ? 'stop_session' : 'advance_number'
}

export function dialerStopIsPending(
  sessionId: string | null | undefined,
  stopRequestedSessionId: string | null | undefined,
): boolean {
  return Boolean(sessionId && sessionId === stopRequestedSessionId)
}
