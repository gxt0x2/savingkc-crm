/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  loadSession: vi.fn(),
  presence: vi.fn(),
}))

vi.mock('@/lib/dialer-session-client', () => ({
  DialerSessionClientError: class DialerSessionClientError extends Error {},
  heartbeatDurableDialerSessionControl: mocks.heartbeat,
  isDialerControlLossError: () => false,
  loadDialerAttemptHistory: vi.fn(),
  loadDurableDialerSession: mocks.loadSession,
  requestPauseDurableDialerSession: vi.fn(),
  takeOverDurableDialerSession: vi.fn(),
  transitionDurableDialerAttempt: vi.fn(),
  transitionDurableDialerSession: vi.fn(),
}))

vi.mock('@/lib/telephony/dialer-controller-client', () => ({
  newDialerControlRequestId: vi.fn(),
  publishDialerControlTaken: vi.fn(),
}))

vi.mock('@/components/prospecting/use-dialer-control-presence', () => ({
  useDialerControlPresence: mocks.presence,
}))

import { useProspectingSessionControl } from './use-prospecting-session-control'

const session = {
  id: 'session-1',
  status: 'active',
  stopRequestedAt: null,
}

describe('Prospecting session operation hold on reload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadSession.mockResolvedValue(session)
    mocks.heartbeat.mockResolvedValue({
      session,
      control: {
        generation: 4,
        operationActive: true,
        operationLabel: 'Sending text message',
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a reloaded window read-only while the server operation hold is active', async () => {
    const onApplySession = vi.fn()
    const onControlLost = vi.fn()
    const acquired = vi.fn()
    window.addEventListener('dialer-control-acquired', acquired)
    const { result } = renderHook(() => useProspectingSessionControl({
      readOnlyPreview: false,
      sessionId: 'session-1',
      currentSubject: null,
      currentSubjectKey: null,
      autoQueueSubjectKey: null,
      onApplySession,
      onControlLost,
    }))

    await act(async () => { await result.current.initializeSession() })

    expect(mocks.heartbeat).toHaveBeenCalledOnce()
    expect(result.current.controlOwned).toBe(false)
    expect(result.current.controlLocked).toBe(true)
    expect(result.current.autoStartEpoch).toBe(0)
    expect(result.current.heirsAutoStart.autoStart).toBe(false)
    expect(result.current.sessionError).toMatch(/Sending text message.*still finishing/i)
    expect(onApplySession.mock.calls.every(([, armAutoStart]) => armAutoStart === false)).toBe(true)
    expect(acquired).not.toHaveBeenCalled()
    window.removeEventListener('dialer-control-acquired', acquired)
  })

  it('can recheck an expired operation hold without forcing a takeover', async () => {
    const onApplySession = vi.fn()
    const onControlLost = vi.fn()
    const { result } = renderHook(() => useProspectingSessionControl({
      readOnlyPreview: false, sessionId: 'session-1', currentSubject: null,
      currentSubjectKey: null, autoQueueSubjectKey: null, onApplySession, onControlLost,
    }))
    await act(async () => { await result.current.initializeSession() })
    expect(result.current.controlLocked).toBe(true)
    mocks.heartbeat.mockResolvedValue({ session, control: { generation: 4, operationActive: false } })
    await act(async () => { await result.current.retryControl() })
    expect(result.current.controlLocked).toBe(false)
    expect(result.current.controlBusy).toBe(false)
    expect(result.current.sessionError).toBeNull()
    expect(mocks.heartbeat).toHaveBeenCalledTimes(2)
  })

  it('keeps failed control rechecks locked and retryable', async () => {
    const { result } = renderHook(() => useProspectingSessionControl({
      readOnlyPreview: false, sessionId: 'session-1', currentSubject: null,
      currentSubjectKey: null, autoQueueSubjectKey: null, onApplySession: vi.fn(), onControlLost: vi.fn(),
    }))
    mocks.heartbeat.mockRejectedValue(new Error('Network unavailable'))
    await act(async () => { await result.current.retryControl() })
    expect(result.current.controlLocked).toBe(true)
    expect(result.current.controlBusy).toBe(false)
    expect(result.current.sessionError).toBe('Network unavailable')
  })
})
