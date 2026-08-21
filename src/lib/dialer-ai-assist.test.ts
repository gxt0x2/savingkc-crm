import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/components/dialer/dialer-ai-assist.tsx', 'utf8')

describe('dialer AI assist trust boundary', () => {
  it('uses one session-owned, read-only pre-call endpoint', () => {
    expect(source).toContain('/pre-call-brief')
    expect(source).toContain("cache: 'no-store'")
    expect(source).not.toContain("from '@/components/leads/ari-briefing'")
    expect(source).not.toContain("from '@/components/leads/next-action'")
  })

  it('states that opening the brief has no side effects and provides the full contact record', () => {
    expect(source).toContain('Opening it never generates, sends, or saves anything.')
    expect(source).toContain('Review profile')
  })
})
