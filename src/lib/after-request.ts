import { after } from 'next/server'

type AfterWork = () => unknown | Promise<unknown>

function runWork(work: AfterWork): Promise<void> {
  return Promise.resolve()
    .then(work)
    .then(() => undefined)
    .catch((error) => {
      console.error('[after-request] background work failed:', error)
    })
}

function nextWaitUntil(): ((promise: Promise<unknown>) => void) | null {
  try {
    const context = (globalThis as { [key: symbol]: { get?: () => { waitUntil?: (promise: Promise<unknown>) => void } } | undefined })[
      Symbol.for('@next/request-context')
    ]
    const waitUntil = context?.get?.()?.waitUntil
    return typeof waitUntil === 'function' ? waitUntil : null
  } catch {
    return null
  }
}

/**
 * Keep serverless work alive after the HTTP response is sent.
 * Uses Next `after()` (waitUntil under the hood). Falls back to the
 * request-context waitUntil, then a detached promise outside a request.
 */
export function afterRequest(work: AfterWork): void {
  const pending = () => runWork(work)
  try {
    after(pending)
    return
  } catch {
    const waitUntil = nextWaitUntil()
    if (waitUntil) {
      waitUntil(pending())
      return
    }
    void pending()
  }
}
