import { describe, expect, it } from 'vitest'
import { parseDialerPostCallReview, postCallSnapshot } from '@/lib/dialer-post-call-review'

describe('dialer post-call review projection', () => {
  it('stores only the bounded human-review fields from call analysis', () => {
    expect(postCallSnapshot({
      aiSummary: 'Seller wants to move before October.',
      sentiment: 'positive',
      motivationScore: 8,
      nextSteps: ['Call Friday', 'Send offer'],
      agentStrengths: ['Clarified the timeline'],
      agentImprovements: ['Confirm the decision makers'],
      verbatimQuotes: ['A long transcript-derived field that is not projected'],
    })).toEqual({
      sentiment: 'positive',
      motivationScore: 8,
      nextAction: 'Call Friday',
      nextActionAt: null,
      strengths: ['Clarified the timeline'],
      improvements: ['Confirm the decision makers'],
    })
  })

  it('parses malformed rows into a safe not-requested review', () => {
    expect(parseDialerPostCallReview({ post_call_status: 'invented', post_call_snapshot: [] })).toMatchObject({
      status: 'not_requested',
      summary: null,
      strengths: [],
      improvements: [],
    })
  })
})
