/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'ernest-user-id', email: 'ernest@savingkc.com' }, loading: false } as {
    user: { id: string; email: string } | null
    loading: boolean
  },
  load: vi.fn(),
  archive: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/lib/ai/assistant-client', () => ({
  loadLatestAssistantThread: mocks.load,
  archiveAssistantConversation: mocks.archive,
  sendAssistantMessage: mocks.send,
}))

import { useAssistantThread } from './use-assistant-thread'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('useAssistantThread private account state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth = { user: { id: 'ernest-user-id', email: 'ernest@savingkc.com' }, loading: false }
    mocks.load.mockResolvedValue({
      thread: { id: 'ernest-thread' },
      messages: [{ id: 'ernest-message', role: 'user', content: 'Ernest private note' }],
    })
  })

  it('clears the prior transcript and reloads when the authenticated subject changes', async () => {
    const { result, rerender } = renderHook(() => useAssistantThread('ai_page'))
    await waitFor(() => expect(result.current.threadId).toBe('ernest-thread'))
    expect(result.current.ownerEmail).toBe('ernest@savingkc.com')

    mocks.load.mockResolvedValueOnce({
      thread: { id: 'casey-thread' },
      messages: [{ id: 'casey-message', role: 'user', content: 'Casey private note' }],
    })
    mocks.auth = { user: { id: 'casey-user-id', email: 'casey@savingkc.com' }, loading: false }
    rerender()

    expect(result.current.threadId).toBeNull()
    expect(result.current.messages).toEqual([])
    await waitFor(() => expect(result.current.threadId).toBe('casey-thread'))
    expect(result.current.ownerEmail).toBe('casey@savingkc.com')
    expect(result.current.messages).toEqual([expect.objectContaining({ id: 'casey-message' })])
    expect(mocks.load).toHaveBeenCalledTimes(2)
  })

  it('does not request history until authentication identifies the owner', async () => {
    mocks.auth = { user: null, loading: true }
    const { result, rerender } = renderHook(() => useAssistantThread('giraffe'))
    expect(result.current.loadingHistory).toBe(true)
    expect(mocks.load).not.toHaveBeenCalled()

    mocks.auth = { user: null, loading: false }
    rerender()
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('discards an in-flight response if the signed-in account changes', async () => {
    const pending = deferred<Record<string, unknown>>()
    mocks.send.mockReturnValueOnce(pending.promise)
    const { result, rerender } = renderHook(() => useAssistantThread('ai_page'))
    await waitFor(() => expect(result.current.threadId).toBe('ernest-thread'))

    let request!: Promise<boolean>
    act(() => { request = result.current.send('Ernest private question') })
    await waitFor(() => expect(result.current.sending).toBe(true))

    mocks.load.mockResolvedValueOnce({ thread: { id: 'casey-thread' }, messages: [] })
    mocks.auth = { user: { id: 'casey-user-id', email: 'casey@savingkc.com' }, loading: false }
    rerender()
    await waitFor(() => expect(result.current.threadId).toBe('casey-thread'))

    await act(async () => {
      pending.resolve({
        threadId: 'ernest-thread', responseMessageId: 'ernest-response', reply: 'Ernest private answer',
        sources: [], provider: 'openai', model: 'model', usage: null, estimatedCostMicros: null,
      })
      await request
    })
    expect(result.current.ownerEmail).toBe('casey@savingkc.com')
    expect(result.current.messages).toEqual([])
  })
})
