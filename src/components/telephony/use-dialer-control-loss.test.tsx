/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useDialerControlLoss } from './use-dialer-control-loss'

function Harness({
  sessionId = 'session-1',
  callInProgress = false,
  cancelAutoStart,
  disconnect,
  endQueue,
}: {
  sessionId?: string | null
  callInProgress?: boolean
  cancelAutoStart: () => void
  disconnect: () => void
  endQueue: () => void
}) {
  const callRef = useRef<{ disconnect: () => void } | null>(callInProgress ? { disconnect } : null)
  const callIntentPendingRef = useRef(false)
  const controlUnavailable = useDialerControlLoss(
    sessionId,
    cancelAutoStart,
    endQueue,
    callRef,
    callIntentPendingRef,
  )
  return <p>{controlUnavailable ? 'Open elsewhere' : 'Controls available'}</p>
}

describe('useDialerControlLoss', () => {
  it('locks the matching session until that same session reacquires control', () => {
    const cancelAutoStart = vi.fn()
    const disconnect = vi.fn()
    const endQueue = vi.fn()
    render(<Harness cancelAutoStart={cancelAutoStart} disconnect={disconnect} endQueue={endQueue} />)

    act(() => window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId: 'session-2' } })))
    expect(screen.getByText('Controls available')).toBeVisible()

    act(() => window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId: 'session-1' } })))
    expect(screen.getByText('Open elsewhere')).toBeVisible()
    expect(cancelAutoStart).toHaveBeenCalledOnce()
    expect(endQueue).toHaveBeenCalledOnce()
    expect(disconnect).not.toHaveBeenCalled()

    act(() => window.dispatchEvent(new CustomEvent('dialer-control-acquired', { detail: { sessionId: 'session-1' } })))
    expect(screen.getByText('Controls available')).toBeVisible()
  })

  it('disconnects and clears a call immediately when another browser takes control', () => {
    const cancelAutoStart = vi.fn()
    const disconnect = vi.fn()
    const endQueue = vi.fn()
    render(<Harness callInProgress cancelAutoStart={cancelAutoStart} disconnect={disconnect} endQueue={endQueue} />)

    act(() => window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId: 'session-1' } })))

    expect(screen.getByText('Open elsewhere')).toBeVisible()
    expect(cancelAutoStart).toHaveBeenCalledOnce()
    expect(endQueue).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
