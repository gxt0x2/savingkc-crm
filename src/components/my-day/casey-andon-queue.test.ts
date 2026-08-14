import { describe, expect, it } from 'vitest'

import { affectsCasey } from './casey-andon-queue'

describe('Casey Andon scope', () => {
  it('includes issues directly affecting Casey or Acquisitions', () => {
    expect(affectsCasey({ department: 'Acquisitions', assignee: null })).toBe(true)
    expect(affectsCasey({ department: 'System', assignee: 'Casey' })).toBe(true)
  })

  it('excludes unrelated department and agent issues', () => {
    expect(affectsCasey({ department: 'Dispositions', assignee: 'Gertha' })).toBe(false)
    expect(affectsCasey({ department: 'System', assignee: null })).toBe(false)
  })
})
