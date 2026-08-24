import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('scripts/ci/check-prospecting-v1-production-preflight.mjs', 'utf8')

describe('Prospecting V1 production preflight', () => {
  it('uses aggregate-only HEAD requests and never prints credential values', () => {
    expect(source).toContain("method: 'HEAD'")
    expect(source).toContain("Prefer: 'count=exact'")
    expect(source).not.toMatch(/method:\s*['"]GET['"]/)
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*process\.env/)
  })

  it('fails closed when live campaign work exists or required counts are unavailable', () => {
    expect(source).toContain('activeSmsCampaigns.count > 0')
    expect(source).toContain('pausedSmsCampaigns.count > 0')
    expect(source).toContain('queuedCampaignActions.count > 0')
    expect(source).toContain('required.some((result) => !result.reachable || result.count == null)')
    expect(source).toContain('process.exit(1)')
  })
})
