/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FIRST_DIAL_COUNTDOWN_SECONDS, useDialerStartCountdown } from './use-dialer-start-countdown'

describe('useDialerStartCountdown', () => {
  afterEach(() => vi.useRealTimers())

  it('delays the first automatic call for fifteen seconds', async () => {
    vi.useFakeTimers()
    const pending = { current: false }
    const { result } = renderHook(() => useDialerStartCountdown(pending))

    act(() => result.current.arm('session-1'))
    expect(pending.current).toBe(true)
    expect(result.current.remainingSeconds).toBe(FIRST_DIAL_COUNTDOWN_SECONDS)

    for (let second = 0; second < 14; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    }
    expect(result.current.remainingSeconds).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(result.current.remainingSeconds).toBe(0)
  })

  it('cancels the pending dial immediately when the agent pauses', () => {
    const pending = { current: false }
    const { result } = renderHook(() => useDialerStartCountdown(pending))

    act(() => result.current.arm('session-1'))
    act(() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'pause' } })))

    expect(pending.current).toBe(false)
    expect(result.current.remainingSeconds).toBeNull()
  })

  it('cancels the pending dial immediately when this window loses session control', () => {
    const pending = { current: false }
    const { result } = renderHook(() => useDialerStartCountdown(pending, 'session-1'))

    act(() => result.current.arm('session-1'))
    act(() => window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId: 'session-1' } })))

    expect(pending.current).toBe(false)
    expect(result.current.remainingSeconds).toBeNull()
  })

  it('keeps another session countdown running when an unrelated window loses control', () => {
    const pending = { current: false }
    const { result } = renderHook(() => useDialerStartCountdown(pending, 'session-1'))

    act(() => result.current.arm('session-1'))
    act(() => window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId: 'session-2' } })))

    expect(pending.current).toBe(true)
    expect(result.current.remainingSeconds).toBe(FIRST_DIAL_COUNTDOWN_SECONDS)
  })

  it('requires a fresh countdown when control returns after this session already dialed', () => {
    const pending = { current: false }
    const { result } = renderHook(() => useDialerStartCountdown(pending, 'session-1'))

    act(() => result.current.arm('session-1'))
    act(() => result.current.finish())
    act(() => window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId: 'session-1' } })))
    act(() => result.current.arm('session-1'))

    expect(pending.current).toBe(true)
    expect(result.current.remainingSeconds).toBe(FIRST_DIAL_COUNTDOWN_SECONDS)
  })

  it('does not repeat the first-call delay for the next seller in one session', () => {
    const pending = { current: false }
    const { result } = renderHook(() => useDialerStartCountdown(pending))

    act(() => result.current.arm('session-1'))
    act(() => result.current.finish())
    act(() => result.current.arm('session-1'))

    expect(pending.current).toBe(true)
    expect(result.current.remainingSeconds).toBeNull()
  })

  it('requires a fresh countdown when a paused session is resumed', () => {
    const pending = { current: false }
    const { result } = renderHook(() => useDialerStartCountdown(pending, 'session-1'))

    act(() => result.current.arm('session-1'))
    act(() => result.current.finish())
    act(() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'pause' } })))
    act(() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'resume' } })))
    act(() => result.current.arm('session-1'))

    expect(result.current.remainingSeconds).toBe(FIRST_DIAL_COUNTDOWN_SECONDS)
  })

  it('preserves an active countdown across queue refreshes and restarts it after a pre-call pause', () => {
    const pending = { current: false }
    const { result } = renderHook(() => useDialerStartCountdown(pending))

    act(() => result.current.arm('session-1'))
    act(() => result.current.arm('session-1'))
    expect(result.current.remainingSeconds).toBe(FIRST_DIAL_COUNTDOWN_SECONDS)

    act(() => result.current.cancel())
    act(() => result.current.arm('session-1'))
    expect(pending.current).toBe(true)
    expect(result.current.remainingSeconds).toBe(FIRST_DIAL_COUNTDOWN_SECONDS)
  })
})
