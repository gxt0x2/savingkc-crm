import { describe, expect, it } from 'vitest'

import {
  DIALER_PROVIDER_DEADLINE_MS,
  dialerProviderDeadlineExceeded,
  dialerProviderSignal,
} from './dialer-provider-boundary'

const controlledSession = { id: 'session-1' } as Parameters<typeof dialerProviderSignal>[1]

describe('dialer provider boundary', () => {
  it('caps protected provider work at no more than sixty seconds', () => {
    expect(DIALER_PROVIDER_DEADLINE_MS).toBe(60_000)
    expect(() => dialerProviderSignal(
      new Request('https://crm.savingkc.com/api/provider'),
      controlledSession,
      DIALER_PROVIDER_DEADLINE_MS + 1,
    )).toThrow('Dialer provider deadline is invalid')
  })

  it('propagates request cancellation only for a controlled dialer operation', () => {
    const controller = new AbortController()
    const request = new Request('https://crm.savingkc.com/api/provider', { signal: controller.signal })
    const protectedSignal = dialerProviderSignal(request, controlledSession)

    expect(dialerProviderSignal(request, null)).toBeUndefined()
    expect(protectedSignal?.aborted).toBe(false)
    controller.abort(new DOMException('Client disconnected', 'AbortError'))
    expect(protectedSignal?.aborted).toBe(true)
    expect(protectedSignal?.reason).toMatchObject({ name: 'AbortError' })
  })

  it('distinguishes a provider deadline from caller cancellation', async () => {
    const deadline = AbortSignal.timeout(1)
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(dialerProviderDeadlineExceeded(deadline)).toBe(true)
    expect(dialerProviderDeadlineExceeded(AbortSignal.abort(new DOMException('Cancelled', 'AbortError')))).toBe(false)
  })
})
