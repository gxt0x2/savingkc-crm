import { EventEmitter } from 'node:events'
import type { Call } from '@twilio/voice-sdk'
import { describe, expect, it, vi } from 'vitest'
import { bindCallRingback } from './call-ringback'

function fixture() {
  const call = new EventEmitter()
  const controls = { play: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), log: vi.fn() }
  // Preserve another consumer's error handler when ringback removes its own.
  call.on('error', () => {})
  const dispose = bindCallRingback(call as unknown as Call, controls)
  return { call, controls, dispose }
}

describe('outgoing ringback handoff', () => {
  it('stops fallback when a later ringing event supplies early media', () => {
    const { call, controls } = fixture()
    call.emit('ringing', false)
    call.emit('ringing', false)
    expect(controls.play).toHaveBeenCalledOnce()
    call.emit('ringing', true)
    expect(controls.stop).toHaveBeenCalledOnce()
    call.emit('volume', 0, 0)
    call.emit('ringing', false)
    expect(controls.play).toHaveBeenCalledOnce()
  })
  it('hands off when remote audio starts without a second ringing event', () => {
    const { call, controls } = fixture()
    call.emit('ringing', false)
    call.emit('volume', 0.7, 0)
    expect(controls.stop).not.toHaveBeenCalled()
    call.emit('volume', 0, 0.2)
    expect(controls.stop).toHaveBeenCalledOnce()
    call.emit('volume', 0, 0)
    call.emit('ringing', false)
    expect(controls.play).toHaveBeenCalledOnce()
  })
  it('never starts local ringing when remote media is already present', () => {
    const { call, controls } = fixture()
    call.emit('volume', 0, 0.2)
    call.emit('ringing', false)
    expect(controls.play).not.toHaveBeenCalled()
  })
  it('uses early media from the first ringing event without local fallback', () => {
    const { call, controls } = fixture()
    call.emit('ringing', true)
    call.emit('ringing', false)
    expect(controls.play).not.toHaveBeenCalled()
  })
  it.each(['accept', 'disconnect', 'cancel', 'reject', 'error'])('stops and detaches on %s', (event) => {
    const { call, controls } = fixture()
    call.emit('ringing', false)
    call.emit(event)
    expect(controls.stop).toHaveBeenCalledOnce()
    expect(call.listenerCount('volume')).toBe(0)
    call.emit('ringing', false)
    expect(controls.play).toHaveBeenCalledOnce()
  })
  it('disposes idempotently without removing other call handlers', () => {
    const { call, controls, dispose } = fixture()
    dispose()
    dispose()
    expect(controls.stop).toHaveBeenCalledOnce()
    expect(call.listenerCount('error')).toBe(1)
  })
})
