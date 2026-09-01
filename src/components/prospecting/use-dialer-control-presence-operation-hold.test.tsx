/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock('@/lib/dialer-session-client', () => ({
  DialerSessionClientError: class DialerSessionClientError extends Error {},
  heartbeatDurableDialerSessionControl: mocks.heartbeat,
  isDialerControlLossError: () => false,
}))

vi.mock('@/lib/telephony/dialer-controller-client', () => ({
  dialerControllerHeaders: vi.fn(async () => ({
    'X-Dialer-Controller': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  })),
  newDialerControlRequestId: vi.fn(() => '00000000-0000-4000-8000-000000000020'),
  subscribeToDialerControlTaken: mocks.subscribe,
}))

import { useDialerControlPresence } from './use-dialer-control-presence'
import { withDialerSessionControlOperation } from '@/lib/telephony/dialer-control-operation-client'

const TEST_IDLE_EXPIRES_AT = new Date(Date.now() + 300_000).toISOString()

function response(ok: boolean, body: Record<string, unknown> = {}) {
  return { ok, json: async () => body }
}

function Harness({ onAccept }: { onAccept: () => void }) {
  const [owned, setOwned] = useState(true)
  const [autoStartEpoch, setAutoStartEpoch] = useState(0)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const ownedRef = useRef(true)
  const generationRef = useRef(0)
  const revisionRef = useRef(0)

  const setHasControl = useCallback((nextOwned: boolean) => {
    const previouslyOwned = ownedRef.current
    revisionRef.current += 1
    ownedRef.current = nextOwned
    setOwned(nextOwned)
    if (nextOwned && !previouslyOwned) setAutoStartEpoch((current) => current + 1)
  }, [])
  const acceptVerifiedControl = useCallback(() => {
    onAccept()
    setHasControl(true)
    window.dispatchEvent(new CustomEvent('dialer-control-acquired', { detail: { sessionId: 'session-1' } }))
    return true
  }, [onAccept, setHasControl])

  useDialerControlPresence({
    readOnlyPreview: false,
    sessionId: 'session-1',
    idleExpiresAt: TEST_IDLE_EXPIRES_AT,
    controlOwned: owned,
    controlOwnedRef: ownedRef,
    controlGenerationRef: generationRef,
    controlRevisionRef: revisionRef,
    setHasControl,
    acceptVerifiedControl,
    showControlConflict: () => false,
    setSessionError,
    applySession: () => {},
    onUserActivity: () => {},
  })

  return <div>
    <p>{owned ? 'Controls owned' : 'Read only'}</p>
    <p>Epoch {autoStartEpoch}</p>
    {sessionError ? <p>{sessionError}</p> : null}
  </div>
}

describe('terminal CRM operation hold', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.heartbeat.mockResolvedValue({})
    mocks.subscribe.mockReturnValue(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not heartbeat-accept, emit acquired, or re-arm after PATCH renewal fails', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return response(false, { error: 'Renewal unavailable' })
      return response(true)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onAccept = vi.fn()
    const onAcquired = vi.fn()
    window.addEventListener('dialer-control-acquired', onAcquired)
    render(<Harness onAccept={onAccept} />)

    const operation = withDialerSessionControlOperation('session-1', 'Long CRM save', async (_headers, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const failure = expect(operation).rejects.toThrow('Dialing control could not be renewed. Renewal unavailable')
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    await failure

    expect(mocks.heartbeat).toHaveBeenCalledTimes(2)
    expect(onAccept).not.toHaveBeenCalled()
    expect(onAcquired).not.toHaveBeenCalled()
    expect(screen.getByText('Read only')).toBeVisible()
    expect(screen.getByText('Epoch 0')).toBeVisible()
    expect(screen.getByText(/Dialing control could not be renewed/i)).toBeVisible()
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'PATCH'])

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(mocks.heartbeat).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Read only')).toBeVisible()
    window.removeEventListener('dialer-control-acquired', onAcquired)
  })
})
