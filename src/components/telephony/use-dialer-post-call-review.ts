'use client'

import { useEffect, useState } from 'react'
import type { DialerPostCallReview } from '@/lib/dialer-post-call-review'
import { loadDialerPostCallReview } from '@/lib/dialer-session-client'

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 20
const TERMINAL = new Set<DialerPostCallReview['status']>(['ready', 'unavailable', 'skipped'])

export function useDialerPostCallReview(input: {
  open: boolean
  sessionId: string | null
  clientAttemptId: string | null
}) {
  const contextKey = input.open && input.sessionId && input.clientAttemptId
    ? `${input.sessionId}:${input.clientAttemptId}`
    : null
  const [state, setState] = useState<{ key: string; review: DialerPostCallReview } | null>(null)

  useEffect(() => {
    if (!contextKey || !input.sessionId || !input.clientAttemptId) return
    const activeKey = contextKey
    const sessionId = input.sessionId
    const clientAttemptId = input.clientAttemptId

    let cancelled = false
    let timeoutId: number | null = null
    let polls = 0

    async function refresh() {
      try {
        const next = await loadDialerPostCallReview(sessionId, clientAttemptId)
        if (cancelled) return
        setState({ key: activeKey, review: next })
        polls += 1
        if (!TERMINAL.has(next.status) && polls < MAX_POLLS) {
          timeoutId = window.setTimeout(refresh, POLL_INTERVAL_MS)
        }
      } catch {
        if (cancelled) return
        polls += 1
        if (polls < MAX_POLLS) {
          timeoutId = window.setTimeout(refresh, POLL_INTERVAL_MS)
        } else {
          setState({ key: activeKey, review: {
            status: 'unavailable',
            summary: null,
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
            failureCode: 'review_request_failed',
            changeProposal: null,
          } })
        }
      }
    }

    void refresh()
    return () => {
      cancelled = true
      if (timeoutId != null) window.clearTimeout(timeoutId)
    }
  }, [contextKey, input.clientAttemptId, input.sessionId])

  return contextKey && state?.key === contextKey ? state.review : null
}
