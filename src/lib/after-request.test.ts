import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
}))

vi.mock('next/server', () => ({
  after: (task: () => unknown) => mocks.after(task),
}))

import { afterRequest } from '@/lib/after-request'

const REQUEST_CONTEXT = Symbol.for('@next/request-context')

describe('afterRequest', () => {
  const previousContext = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.after.mockImplementation((task: () => unknown) => {
      void task()
    })
    delete (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT]
  })

  afterEach(() => {
    if (previousContext === undefined) delete (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT]
    else (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = previousContext
  })

  it('schedules work with after() and does not run it until that callback runs', async () => {
    const work = vi.fn()
    let scheduled: (() => unknown) | undefined
    mocks.after.mockImplementation((task: () => unknown) => {
      scheduled = task
    })

    afterRequest(work)

    expect(mocks.after).toHaveBeenCalledTimes(1)
    expect(work).not.toHaveBeenCalled()
    await scheduled?.()
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('uses waitUntil when after() is unavailable but a request context exists', async () => {
    mocks.after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope.')
    })
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise
    })
    ;(globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = {
      get: () => ({ waitUntil }),
    }
    const work = vi.fn()

    afterRequest(work)

    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0][0]
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('still starts work when after() throws outside a request', async () => {
    mocks.after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope.')
    })
    const work = vi.fn()

    afterRequest(work)

    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(1))
  })

  it('swallows background errors so the response path cannot reject', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    afterRequest(() => {
      throw new Error('push failed')
    })
    await vi.waitFor(() => expect(errors).toHaveBeenCalled())
    errors.mockRestore()
  })
})
