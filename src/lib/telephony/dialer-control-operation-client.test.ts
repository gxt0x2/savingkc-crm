/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dialerControllerHeaders: vi.fn(),
  newDialerControlRequestId: vi.fn(),
}))

vi.mock('@/lib/telephony/dialer-controller-client', () => ({
  dialerControllerHeaders: mocks.dialerControllerHeaders,
  newDialerControlRequestId: mocks.newDialerControlRequestId,
}))

import {
  DIALER_CONTROL_LOSS_OPERATION_HOLD,
  DialerOperationHoldRetainedError,
  withDialerSessionControlOperation,
} from './dialer-control-operation-client'

const operationId = '00000000-0000-4000-8000-000000000020'
const controller = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function response(ok: boolean, body: Record<string, unknown> = {}) {
  return { ok, json: async () => body }
}

describe('withDialerSessionControlOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dialerControllerHeaders.mockResolvedValue({ 'X-Dialer-Controller': controller })
    mocks.newDialerControlRequestId.mockReturnValue(operationId)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('begins, scopes the CRM write, and always releases the matching operation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(true, { control: { operationActive: true } }))
      .mockResolvedValueOnce(response(true, { control: { operationActive: false } }))
    vi.stubGlobal('fetch', fetchMock)
    const work = vi.fn(async (headers: Record<string, string>) => headers)

    await expect(withDialerSessionControlOperation('session/1', 'Saving contact note', work)).resolves.toEqual({
      'X-Dialer-Controller': controller,
      'X-Dialer-Operation': operationId,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      '/api/dialer/sessions/session%2F1/control/operations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Dialer-Controller': controller }),
        body: JSON.stringify({ operationId, label: 'Saving contact note' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      '/api/dialer/sessions/session%2F1/control/operations',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ 'X-Dialer-Controller': controller }),
        body: JSON.stringify({ operationId }),
      }),
    )
  })

  it('blocks the CRM callback when begin fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(false, {
      error: 'This session is controlled in another window.',
      code: 'session_control_lost',
    })))
    const work = vi.fn()
    const lost = vi.fn()
    window.addEventListener('dialer-control-lost', lost)

    await expect(withDialerSessionControlOperation('session-1', 'Saving', work))
      .rejects.toThrow('This session is controlled in another window.')
    expect(work).not.toHaveBeenCalled()
    expect(lost).toHaveBeenCalledOnce()
    window.removeEventListener('dialer-control-lost', lost)
  })

  it('retains the hold when work throws after a provider or server may have committed', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(true))
    vi.stubGlobal('fetch', fetchMock)
    const original = new TypeError('network response was lost')
    const lost = vi.fn()
    window.addEventListener('dialer-control-lost', lost)

    await expect(withDialerSessionControlOperation('session-1', 'Sending text', async () => {
      throw original
    })).rejects.toBe(original)
    expect(lost).toHaveBeenCalledOnce()
    expect((lost.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      sessionId: 'session-1',
      reason: DIALER_CONTROL_LOSS_OPERATION_HOLD,
      terminal: true,
    })
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST'])
    window.removeEventListener('dialer-control-lost', lost)
  })

  it('surfaces a safe hold warning when successful work cannot release its lease', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(true))
      .mockResolvedValueOnce(response(false, { error: 'Release failed' })))

    await expect(withDialerSessionControlOperation('session-1', 'Saving', async () => 'saved'))
      .rejects.toThrow('The change was saved, but dialing control could not be released. Release failed')
  })

  it('returns a failed HTTP response instead of incorrectly saying the change was saved when cleanup fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(true))
      .mockResolvedValueOnce(response(false, { error: 'Release failed' })))
    const failedResponse = { ok: false, status: 409 }
    const lost = vi.fn()
    window.addEventListener('dialer-control-lost', lost)

    await expect(withDialerSessionControlOperation('session-1', 'Saving', async () => failedResponse))
      .resolves.toBe(failedResponse)
    expect(lost).toHaveBeenCalledOnce()
    expect((lost.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      reason: DIALER_CONTROL_LOSS_OPERATION_HOLD,
      terminal: true,
    })
    window.removeEventListener('dialer-control-lost', lost)
  })

  it('does not create a lease for CRM use outside a dialing session', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const work = vi.fn(async (headers: Record<string, string>, signal: AbortSignal) => ({ headers, signal }))

    const result = await withDialerSessionControlOperation(null, 'Saving', work)
    expect(result.headers).toEqual({})
    expect(result.signal).toBeInstanceOf(AbortSignal)
    expect(result.signal.aborted).toBe(false)
    expect(work).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.dialerControllerHeaders).not.toHaveBeenCalled()
  })

  it('retains the operation hold when work partially commits and cannot finish its durable follow-up', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(true, { control: { operationActive: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const lost = vi.fn()
    window.addEventListener('dialer-control-lost', lost)
    const partialCommit = new DialerOperationHoldRetainedError('Lead saved, but durable skip failed.')

    await expect(withDialerSessionControlOperation('session-1', 'Marking lead dead', async () => {
      throw partialCommit
    })).rejects.toBe(partialCommit)

    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST'])
    expect((lost.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      sessionId: 'session-1',
      reason: DIALER_CONTROL_LOSS_OPERATION_HOLD,
      terminal: true,
      message: partialCommit.message,
    })
    window.removeEventListener('dialer-control-lost', lost)
  })

  it('retains the hold when a provider returns an explicit delivery-unknown response', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(true, { control: { operationActive: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const lost = vi.fn()
    window.addEventListener('dialer-control-lost', lost)
    const uncertain = new Response(JSON.stringify({ error: 'Delivery status is unknown' }), {
      status: 504,
      headers: { 'X-Dialer-Operation-Uncertain': 'true' },
    })

    await expect(withDialerSessionControlOperation('session-1', 'Sending text', async () => uncertain))
      .resolves.toBe(uncertain)

    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST'])
    expect((lost.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      sessionId: 'session-1',
      reason: DIALER_CONTROL_LOSS_OPERATION_HOLD,
      terminal: true,
    })
    window.removeEventListener('dialer-control-lost', lost)
  })

  it('retries an uncertain begin once with the same operation id before starting work', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network interrupted'))
      .mockResolvedValueOnce(response(true))
      .mockResolvedValueOnce(response(true))
    vi.stubGlobal('fetch', fetchMock)
    const work = vi.fn(async () => 'saved')

    await expect(withDialerSessionControlOperation('session-1', 'Saving', work)).resolves.toBe('saved')

    expect(work).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'POST', 'DELETE'])
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body)
  })

  it('locks the dialer and blocks work when both begin confirmations are uncertain', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network interrupted'))
    vi.stubGlobal('fetch', fetchMock)
    const work = vi.fn()
    const lost = vi.fn()
    window.addEventListener('dialer-control-lost', lost)

    await expect(withDialerSessionControlOperation('session-1', 'Saving', work))
      .rejects.toThrow('could not confirm that the CRM change hold started')

    expect(work).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'POST'])
    expect((lost.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      reason: DIALER_CONTROL_LOSS_OPERATION_HOLD,
      terminal: true,
    })
    window.removeEventListener('dialer-control-lost', lost)
  })

  it('renews before the server TTL and stops renewing as soon as work completes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(response(true))
    vi.stubGlobal('fetch', fetchMock)
    let finishWork: (value: string) => void = () => {}
    const work = vi.fn((headers: Record<string, string>, signal: AbortSignal) => new Promise<string>((resolve) => {
      expect(headers).toEqual(expect.objectContaining({ 'X-Dialer-Operation': operationId }))
      expect(signal).toBeInstanceOf(AbortSignal)
      finishWork = resolve
    }))

    const operation = withDialerSessionControlOperation('session-1', 'Long CRM save', work)
    await vi.advanceTimersByTimeAsync(0)
    expect(work).toHaveBeenCalledOnce()
    expect(work.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)

    await vi.advanceTimersByTimeAsync(29_999)
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST'])
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'PATCH'])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'PATCH', 'PATCH'])

    finishWork('saved')
    await expect(operation).resolves.toBe('saved')
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'PATCH', 'PATCH', 'DELETE'])
    await vi.advanceTimersByTimeAsync(90_000)
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'PATCH', 'PATCH', 'DELETE'])
  })

  it('fails closed and aborts the CRM request when renewal cannot be confirmed', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(true))
      .mockResolvedValueOnce(response(false, { error: 'Renewal unavailable' }))
      .mockResolvedValueOnce(response(true))
    vi.stubGlobal('fetch', fetchMock)
    const lost = vi.fn()
    window.addEventListener('dialer-control-lost', lost)

    const operation = withDialerSessionControlOperation('session-1', 'Long CRM save', async (_headers, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const failure = expect(operation).rejects.toThrow('Dialing control could not be renewed. Renewal unavailable')
    await vi.advanceTimersByTimeAsync(30_000)

    await failure
    expect(lost).toHaveBeenCalled()
    expect((lost.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      reason: DIALER_CONTROL_LOSS_OPERATION_HOLD,
      terminal: true,
    })
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'PATCH'])
    window.removeEventListener('dialer-control-lost', lost)
  })

  it('fails closed before TTL when a renewal request stalls', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Promise<never>(() => {})
      return Promise.resolve(response(true))
    })
    vi.stubGlobal('fetch', fetchMock)

    const operation = withDialerSessionControlOperation('session-1', 'Long CRM save', async (_headers, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const failure = expect(operation).rejects.toThrow('The dialing-control renewal timed out.')
    await vi.advanceTimersByTimeAsync(40_000)

    await failure
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'PATCH'])
  })
})
