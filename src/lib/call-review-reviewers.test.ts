import { describe, expect, it } from 'vitest'

import { CALL_REVIEWERS, isCallReviewer } from './call-review-reviewers'

describe('call review access', () => {
  it('keeps Casey’s agent account out of the designated reviewer list', () => {
    expect(isCallReviewer('casey@savingkc.com')).toBe(false)
    expect(CALL_REVIEWERS.map((reviewer) => reviewer.email)).not.toContain('casey@savingkc.com')
  })

  it('allows designated reviewers', () => {
    expect(isCallReviewer('ernest@savingkc.com')).toBe(true)
    expect(isCallReviewer('gertha@savingkc.com')).toBe(true)
  })
})
