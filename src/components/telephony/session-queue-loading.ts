/** How long a Ready phone waits for a session queue before the restoring banner clears. */
export const SESSION_QUEUE_RESTORE_TIMEOUT_MS = 8_000

export function sessionQueueRestorePending(input: {
  pendingSessionId: string | null
  pendingQueue: readonly unknown[] | null | undefined
  queueLength: number
}): boolean {
  if (!input.pendingSessionId) return false
  if (input.queueLength > 0) return false
  // An array is a settled restore, including an empty seller list.
  if (Array.isArray(input.pendingQueue)) return false
  return true
}

/**
 * The restoring banner stays while Twilio is still connecting.
 * Once the device is Ready, it clears after the wait times out, the restore
 * fails, or the session is already finished.
 */
export function showSessionQueueLoading(input: {
  restorePending: boolean
  deviceReady: boolean
  restoreFailed: boolean
  sessionTerminal: boolean
  readyTimedOut: boolean
}): boolean {
  if (!input.restorePending) return false
  if (!input.deviceReady) return true
  if (input.restoreFailed || input.sessionTerminal || input.readyTimedOut) return false
  return true
}
