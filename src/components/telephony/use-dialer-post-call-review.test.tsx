/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ loadDialerPostCallReview: vi.fn() }))

vi.mock('@/lib/dialer-session-client', () => ({
  loadDialerPostCallReview: mocks.loadDialerPostCallReview,
}))

import { useDialerPostCallReview } from './use-dialer-post-call-review'

function review(status: 'processing' | 'ready', summary: string | null = null) {
  return {
    status,
    summary,
    sentiment: null,
    motivationScore: null,
    nextAction: null,
    nextActionAt: null,
    strengths: [],
    improvements: [],
    recordingSid: null,
    providerCallSid: null,
    completedAt: null,
    updatedAt: null,
    failureCode: null,
  }
}

describe('useDialerPostCallReview', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('polls only a visible durable attempt and stops after the review is ready', async () => {
    vi.useFakeTimers()
    mocks.loadDialerPostCallReview
      .mockResolvedValueOnce(review('processing'))
      .mockResolvedValueOnce(review('ready', 'Seller asked for a Friday follow-up.'))

    const { result } = renderHook(() => useDialerPostCallReview({
      open: true,
      sessionId: 'session-1',
      clientAttemptId: 'attempt-1',
    }))

    await act(async () => {})
    expect(result.current?.status).toBe('processing')

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(result.current).toMatchObject({ status: 'ready', summary: 'Seller asked for a Friday follow-up.' })

    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(mocks.loadDialerPostCallReview).toHaveBeenCalledTimes(2)
  })

  it('does not request review data without a visible durable attempt', async () => {
    const { result } = renderHook(() => useDialerPostCallReview({ open: false, sessionId: null, clientAttemptId: null }))
    await waitFor(() => expect(result.current).toBeNull())
    expect(mocks.loadDialerPostCallReview).not.toHaveBeenCalled()
  })
})
