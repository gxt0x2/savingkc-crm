/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MessageHandler = ((event: MessageEvent<unknown>) => void) | null

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()

  onmessage: MessageHandler = null

  constructor(public readonly name: string) {
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>()
    peers.add(this)
    FakeBroadcastChannel.channels.set(name, peers)
  }

  postMessage(data: unknown) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent<unknown>)
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

const storedToken = '10000000-0000-4000-8000-000000000001'
const rotatedToken = '20000000-0000-4000-8000-000000000002'
const controlChannel = 'savingkc:dialer-session-control:v1'
const presenceChannel = 'savingkc:dialer-session-control:v1:presence'

describe('dialer controller browser identity', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    FakeBroadcastChannel.channels.clear()
    window.sessionStorage.clear()
    window.sessionStorage.setItem('savingkc:dialer-controller:v1', storedToken)
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('90000000-0000-4000-8000-000000000009')
      .mockReturnValueOnce(rotatedToken) })
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'navigate' } as PerformanceNavigationTiming])
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (navigator as unknown as { locks?: unknown }).locks
  })

  it('rotates a sessionStorage token copied into another live tab before returning request headers', async () => {
    const existing = new FakeBroadcastChannel(presenceChannel)
    existing.onmessage = (event) => {
      const probe = event.data as { type?: string; token?: string; instanceId?: string }
      if (probe.type !== 'probe') return
      existing.postMessage({
        type: 'present',
        token: probe.token,
        instanceId: 'existing-tab',
        targetInstanceId: probe.instanceId,
      })
    }
    const rotated = vi.fn()
    window.addEventListener('dialer-controller-rotated', rotated)

    const { dialerControllerHeaders } = await import('./dialer-controller-client')
    await expect(dialerControllerHeaders()).resolves.toEqual({ 'X-Dialer-Controller': rotatedToken })
    expect(window.sessionStorage.getItem('savingkc:dialer-controller:v1')).toBe(rotatedToken)
    expect(rotated).toHaveBeenCalledOnce()

    window.removeEventListener('dialer-controller-rotated', rotated)
    existing.close()
  })

  it('preserves the controller on a true same-tab reload', async () => {
    vi.mocked(performance.getEntriesByType).mockReturnValue([{ type: 'reload' } as PerformanceNavigationTiming])
    const existing = new FakeBroadcastChannel(presenceChannel)
    const observed = vi.fn()
    existing.onmessage = observed

    const { dialerControllerHeaders } = await import('./dialer-controller-client')
    await expect(dialerControllerHeaders()).resolves.toEqual({ 'X-Dialer-Controller': storedToken })
    expect(observed).not.toHaveBeenCalled()
    existing.close()
  })

  it('fails closed when no background tab answers a copied stored identity', async () => {
    vi.useFakeTimers()
    const rotated = vi.fn()
    window.addEventListener('dialer-controller-rotated', rotated)

    const { dialerControllerHeaders } = await import('./dialer-controller-client')
    const headers = dialerControllerHeaders()
    await vi.advanceTimersByTimeAsync(75)

    await expect(headers).resolves.toEqual({ 'X-Dialer-Controller': rotatedToken })
    expect(rotated).toHaveBeenCalledOnce()
    window.removeEventListener('dialer-controller-rotated', rotated)
  })

  it('uses an exclusive browser lock before authorizing a copied controller', async () => {
    const request = vi.fn((name: string, _options: unknown, callback: (lock: { name: string } | null) => Promise<void>) => {
      if (name.endsWith(storedToken)) return Promise.resolve(callback(null))
      void callback({ name })
      return new Promise<void>(() => {})
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })

    const { dialerControllerHeaders } = await import('./dialer-controller-client')

    await expect(dialerControllerHeaders()).resolves.toEqual({ 'X-Dialer-Controller': rotatedToken })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('notifies older tabs without making the new controller revoke itself', async () => {
    const {
      publishDialerControlTaken,
      subscribeToDialerControlTaken,
    } = await import('./dialer-controller-client')
    const onTaken = vi.fn()
    const unsubscribe = subscribeToDialerControlTaken('session-1', onTaken)

    publishDialerControlTaken('session-1', 2)
    expect(onTaken).not.toHaveBeenCalled()

    const otherTab = new FakeBroadcastChannel(controlChannel)
    otherTab.postMessage({ type: 'control_taken', sessionId: 'session-1', generation: 3, instanceId: 'other-tab' })
    expect(onTaken).toHaveBeenCalledWith(3)

    otherTab.close()
    unsubscribe()
  })
})
