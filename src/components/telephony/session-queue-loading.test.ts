import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sessionQueueRestorePending, showSessionQueueLoading } from './session-queue-loading'

const waiting = {
  restorePending: true,
  deviceReady: true,
  restoreFailed: false,
  sessionTerminal: false,
  readyTimedOut: false,
}

describe('session queue loading', () => {
  it('keeps waiting only while a session has no settled queue', () => {
    expect(sessionQueueRestorePending({ pendingSessionId: 'session-1', pendingQueue: null, queueLength: 0 })).toBe(true)
    expect(sessionQueueRestorePending({ pendingSessionId: 'session-1', pendingQueue: undefined, queueLength: 0 })).toBe(true)
    expect(sessionQueueRestorePending({ pendingSessionId: null, pendingQueue: null, queueLength: 0 })).toBe(false)
    expect(sessionQueueRestorePending({ pendingSessionId: 'session-1', pendingQueue: [{ phone: '+18165550100' }], queueLength: 0 })).toBe(false)
    expect(sessionQueueRestorePending({ pendingSessionId: 'session-1', pendingQueue: [], queueLength: 0 })).toBe(false)
    expect(sessionQueueRestorePending({ pendingSessionId: 'session-1', pendingQueue: null, queueLength: 2 })).toBe(false)
  })

  it('holds the restoring banner while the phone is still connecting', () => {
    expect(showSessionQueueLoading({ ...waiting, deviceReady: false, restoreFailed: true, sessionTerminal: true, readyTimedOut: true })).toBe(true)
  })

  it('keeps the banner briefly after Ready while the queue can still arrive', () => {
    expect(showSessionQueueLoading(waiting)).toBe(true)
  })

  it('clears the banner once Ready and the restore times out, fails, or the session is finished', () => {
    expect(showSessionQueueLoading({ ...waiting, readyTimedOut: true })).toBe(false)
    expect(showSessionQueueLoading({ ...waiting, restoreFailed: true })).toBe(false)
    expect(showSessionQueueLoading({ ...waiting, sessionTerminal: true })).toBe(false)
  })

  it('does not show the restoring banner after the queue has settled', () => {
    expect(showSessionQueueLoading({ ...waiting, restorePending: false, readyTimedOut: false })).toBe(false)
  })

  it('wires the live dialer to those clear conditions', () => {
    const bar = readFileSync('src/components/telephony/telephony-bar.tsx', 'utf8')
    const hook = readFileSync('src/components/telephony/use-session-queue-restore.ts', 'utf8')
    expect(bar).toContain('useSessionQueueRestoreLoading({')
    expect(bar).toContain('failSessionQueueRestore(pendingSessionId)')
    expect(bar).toContain('loadingSessionQueue={sessionQueueLoading}')
    expect(bar).not.toContain('loadingSessionQueue={Boolean(pendingSessionId && !pendingQueue && !queue?.length)}')
    expect(hook).toContain('showSessionQueueLoading({')
  })
})
