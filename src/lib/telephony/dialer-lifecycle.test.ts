import { describe, expect, it } from 'vitest'

import { dialerStopIsPending, postDispositionCommand } from './dialer-lifecycle'

describe('dialer lifecycle decisions', () => {
  it('advances only after a normal call outcome', () => {
    expect(postDispositionCommand(false)).toBe('advance_number')
  })

  it('stops instead of advancing after an end-session request', () => {
    expect(postDispositionCommand(true)).toBe('stop_session')
  })

  it('binds a stop request to the exact durable session', () => {
    expect(dialerStopIsPending('session-a', 'session-a')).toBe(true)
    expect(dialerStopIsPending('session-a', 'session-b')).toBe(false)
    expect(dialerStopIsPending(null, 'session-a')).toBe(false)
  })
})
