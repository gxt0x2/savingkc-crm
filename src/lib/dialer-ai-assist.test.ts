import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/components/dialer/dialer-ai-assist.tsx', 'utf8')

describe('dialer AI assist trust boundary', () => {
  it('reuses the canonical briefing and next-action engines', () => {
    expect(source).toContain("from '@/components/leads/ari-briefing'")
    expect(source).toContain("from '@/components/leads/next-action'")
    expect(source).toContain('<AriBriefing')
    expect(source).toContain('<NextAction')
  })

  it('states that AI output is review-only and provides the full contact record', () => {
    expect(source).toContain('Nothing is sent or saved automatically.')
    expect(source).toContain('Review profile')
  })
})
