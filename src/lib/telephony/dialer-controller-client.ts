'use client'

const STORAGE_KEY = 'savingkc:dialer-controller:v1'
const CHANNEL_NAME = 'savingkc:dialer-session-control:v1'

let inMemoryToken: string | null = null
let presenceChannel: BroadcastChannel | null = null
let presenceToken: string | null = null
let presenceReady: Promise<void> = Promise.resolve()
let presenceSetupPending = false
let heldControllerLockRelease: (() => void) | null = null
const pageInstanceId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `page-${Date.now()}-${Math.random().toString(36).slice(2)}`

function newToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  throw new Error('This browser cannot create a secure dialing controller. Refresh in a supported browser.')
}

function storeToken(token: string): void {
  inMemoryToken = token
  try { window.sessionStorage.setItem(STORAGE_KEY, token) } catch { /* memory-only token remains safe */ }
}

function isReloadNavigation(): boolean {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return false
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  return navigation?.type === 'reload'
}

function announceControllerRotation(replacement: string): void {
  storeToken(replacement)
  presenceToken = replacement
  window.dispatchEvent(new Event('dialer-controller-rotated'))
}

function startFallbackPresence(token: string, freshlyCreated: boolean): void {
  presenceSetupPending = false
  if (typeof window === 'undefined') return
  if (typeof BroadcastChannel === 'undefined') {
    if (!freshlyCreated && !isReloadNavigation()) announceControllerRotation(newToken())
    presenceReady = Promise.resolve()
    return
  }
  presenceChannel?.close()
  presenceToken = token
  const channel = new BroadcastChannel(`${CHANNEL_NAME}:presence`)
  presenceChannel = channel
  let settlePresence: () => void = () => {}
  let settled = false
  let settleTimer: number | null = null
  presenceReady = new Promise<void>((resolve) => {
    settlePresence = () => {
      if (settled) return
      settled = true
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      resolve()
    }
    settleTimer = window.setTimeout(() => {
      // Without Web Locks, only a true reload may retain a stored controller.
      // A hard navigation or duplicated tab gets a new identity even when no
      // background tab answers the probe in time.
      if (!freshlyCreated && !isReloadNavigation()) announceControllerRotation(newToken())
      settlePresence()
    }, 75)
  })
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data as {
      type?: unknown
      token?: unknown
      instanceId?: unknown
      targetInstanceId?: unknown
    } | null
    if (!message || message.token !== presenceToken || message.instanceId === pageInstanceId) return
    if (message.type === 'probe') {
      channel.postMessage({
        type: 'present',
        token: presenceToken,
        instanceId: pageInstanceId,
        targetInstanceId: message.instanceId,
      })
      return
    }
    if (message.type === 'present' && message.targetInstanceId === pageInstanceId) {
      announceControllerRotation(newToken())
      settlePresence()
    }
  }
  if (freshlyCreated || isReloadNavigation()) settlePresence()
  else channel.postMessage({ type: 'probe', token, instanceId: pageInstanceId })
}

function tryHoldControllerLock(lockManager: LockManager, token: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    void lockManager.request(
      `${CHANNEL_NAME}:controller:${token}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolve(false)
          return
        }
        resolve(true)
        await new Promise<void>((release) => { heldControllerLockRelease = release })
      },
    ).catch(reject)
  })
}

function ensureUniqueLiveTab(token: string, freshlyCreated: boolean): void {
  if (typeof window === 'undefined') return
  if (presenceToken === token && (presenceChannel || heldControllerLockRelease || presenceSetupPending)) return
  presenceToken = token
  presenceSetupPending = true

  const lockManager = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { locks?: LockManager }).locks
  if (lockManager) {
    presenceReady = (async () => {
      let candidate = token
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await tryHoldControllerLock(lockManager, candidate)) {
          if (candidate !== token) announceControllerRotation(candidate)
          presenceSetupPending = false
          window.addEventListener('pagehide', () => {
            heldControllerLockRelease?.()
            heldControllerLockRelease = null
          }, { once: true })
          return
        }
        candidate = newToken()
      }
      throw new Error('Could not establish exclusive dialing control in this browser.')
    })().catch(() => {
      presenceSetupPending = false
      heldControllerLockRelease?.()
      heldControllerLockRelease = null
      startFallbackPresence(token, freshlyCreated)
      return presenceReady
    })
    return
  }

  startFallbackPresence(token, freshlyCreated)
}

export function getDialerControllerToken(): string {
  if (inMemoryToken) {
    ensureUniqueLiveTab(inMemoryToken, false)
    return inMemoryToken
  }
  if (typeof window === 'undefined') return ''
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY)?.trim() || ''
    if (stored) {
      inMemoryToken = stored
      ensureUniqueLiveTab(stored, false)
      return stored
    }
    const created = newToken()
    storeToken(created)
    ensureUniqueLiveTab(created, true)
    return created
  } catch {
    inMemoryToken = newToken()
    ensureUniqueLiveTab(inMemoryToken, true)
    return inMemoryToken
  }
}

export async function dialerControllerHeaders(): Promise<Record<string, string>> {
  getDialerControllerToken()
  await presenceReady
  const token = inMemoryToken
  return token ? { 'X-Dialer-Controller': token } : {}
}

export function newDialerControlRequestId(): string {
  return newToken()
}

export function publishDialerControlTaken(sessionId: string, generation: number): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.postMessage({ type: 'control_taken', sessionId, generation, instanceId: pageInstanceId })
  channel.close()
}

export function subscribeToDialerControlTaken(sessionId: string, onTaken: (generation: number) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data as { type?: unknown; sessionId?: unknown; generation?: unknown; instanceId?: unknown } | null
    const generation = Number(message?.generation)
    if (
      message?.type === 'control_taken'
      && message.sessionId === sessionId
      && message.instanceId !== pageInstanceId
      && Number.isInteger(generation)
      && generation >= 0
    ) onTaken(generation)
  }
  return () => channel.close()
}
