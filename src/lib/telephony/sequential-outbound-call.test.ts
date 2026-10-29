import { describe, expect, it, vi } from 'vitest'
import {
  canStartQueuedDial,
  outboundCallEventOwnsAttempt,
  readParentCallSid,
  shouldClearCallRef,
  waitForCallToClear,
  waitForDeviceIdle,
} from './sequential-outbound-call'

const PARENT_SID = `CA${'a'.repeat(32)}`

describe('sequential outbound dial ownership', () => {
  it('reads only a real parent Call SID from the browser call', () => {
    expect(readParentCallSid({ CallSid: PARENT_SID })).toBe(PARENT_SID)
    expect(readParentCallSid({ CallSid: 'CA_test_outbound' })).toBeNull()
    expect(readParentCallSid(null)).toBeNull()
  })

  it('does not let the previous number close the next attempt', () => {
    expect(outboundCallEventOwnsAttempt('attempt-1', 'attempt-1')).toBe(true)
    expect(outboundCallEventOwnsAttempt('attempt-1', 'attempt-2')).toBe(false)
    expect(outboundCallEventOwnsAttempt('attempt-1', null)).toBe(false)
  })

  it('clears the live call ref only when that same call ended', () => {
    const first = { id: 'first' }
    const second = { id: 'second' }
    expect(shouldClearCallRef(first, first)).toBe(true)
    expect(shouldClearCallRef(second, first)).toBe(false)
    expect(shouldClearCallRef(null, first)).toBe(false)
  })

  it('holds the next queued dial while the device is still on the previous call', () => {
    const ready = {
      pendingAutoDial: true,
      outcomeRequired: false,
      status: 'ready',
      hasQueueItem: true,
      dialNumber: '+18169854482',
      deviceBusy: false,
    }
    expect(canStartQueuedDial(ready)).toBe(true)
    expect(canStartQueuedDial({ ...ready, deviceBusy: true })).toBe(false)
    expect(canStartQueuedDial({ ...ready, outcomeRequired: true })).toBe(false)
    expect(canStartQueuedDial({ ...ready, dialNumber: '   ' })).toBe(false)
  })

  it('waits for the previous call to disconnect before the next connect', async () => {
    let listener: (() => void) | null = null
    const call = {
      on: vi.fn((event: string, next: () => void) => {
        if (event === 'disconnect') listener = next
      }),
    }
    const pending = waitForCallToClear(call, 1000)
    expect(listener).toEqual(expect.any(Function))
    listener?.()
    await pending
  })

  it('stops waiting once the device is idle', async () => {
    const device = { isBusy: true }
    const pending = waitForDeviceIdle(device, 500)
    setTimeout(() => { device.isBusy = false }, 20)
    await pending
    expect(device.isBusy).toBe(false)
  })
})
