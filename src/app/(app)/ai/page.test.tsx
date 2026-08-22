/** @vitest-environment jsdom */

import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AiAssistantPage from './page'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/hooks/use-assistant-thread', () => ({
  useAssistantThread: () => ({
    messages: [],
    loadingHistory: false,
    sending: false,
    error: '',
    send: vi.fn(),
    clear: vi.fn(),
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

describe('AI Assistant live context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads bounded sources independently and distinguishes loading from unavailable', async () => {
    const contacts = deferred<Response>()
    const attention = deferred<Response>()
    const workflows = deferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (input === '/api/contacts?mode=page&limit=1&list=all') return contacts.promise
      if (input === '/api/conversations/attention') return attention.promise
      if (input === '/api/workflows/summary') return workflows.promise
      return Promise.reject(new Error(`Unexpected request: ${String(input)}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AiAssistantPage />)

    expect(screen.getAllByText('Loading…')).toHaveLength(4)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/reports/operating?period=30d', expect.anything())

    await act(async () => {
      workflows.resolve(response({ phones: 21, workflows: 33 }))
    })
    expect(await screen.findByText('21')).toBeVisible()
    expect(screen.getByText('33')).toBeVisible()
    expect(screen.getAllByText('Loading…')).toHaveLength(2)

    await act(async () => {
      contacts.resolve(response({ scopeCounts: { active: 52 } }))
      attention.reject(new Error('attention unavailable'))
    })
    expect(await screen.findByText('52')).toBeVisible()
    expect(screen.getByText('Unavailable')).toBeVisible()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledWith('/api/contacts?mode=page&limit=1&list=all', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/attention', { cache: 'no-store' })
    expect(fetchMock).toHaveBeenCalledWith('/api/workflows/summary', { cache: 'no-store' })
  })
})
