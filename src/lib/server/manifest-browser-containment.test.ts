import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

describe('Manifest browser containment', () => {
  it('keeps browser components away from the Manifest table', () => {
    const offenders = [
      ...filesUnder(resolve(root, 'src/components')),
      ...filesUnder(resolve(root, 'src/app')),
    ]
      .filter((path) => path.endsWith('.tsx'))
      .filter((path) => {
        const source = readFileSync(path, 'utf8')
        return /\.from\(['"]manifests['"]\)/.test(source) || source.includes('/api/manifests')
      })

    expect(offenders).toEqual([])
    expect(existsSync(resolve(root, 'src/components/pipeline/kanban-board.tsx'))).toBe(false)
  })

  it('keeps the lead workspace and Prospecting calling floor off Manifest compatibility data', () => {
    const route = readFileSync(resolve(root, 'src/app/api/leads/[id]/route.ts'), 'utf8')
    const dialer = readFileSync(resolve(root, 'src/lib/dialer-lead-activity.ts'), 'utf8')

    expect(route).toContain('Manifest is historical and is not read')
    expect(route).not.toContain(".from('manifests')")
    expect(existsSync(resolve(root, 'src/hooks/use-lead-manifest-intelligence.ts'))).toBe(false)
    expect(dialer).toContain("/activities?limit=50")
    expect(dialer).not.toContain("@/lib/supabase/client")
    expect(dialer).not.toContain("from('manifests')")
  })

  it('keeps mobile Conversations and the authoritative call gate on durable records', () => {
    const mobileConversations = readFileSync(resolve(root, 'src/app/api/mobile/v1/conversations/route.ts'), 'utf8')
    const callEligibility = readFileSync(resolve(root, 'src/lib/server/dialer-call-eligibility.ts'), 'utf8')
    const callPolicy = readFileSync(resolve(root, 'src/lib/dialer-call-policy.ts'), 'utf8')

    expect(mobileConversations).not.toContain("from('manifests')")
    expect(mobileConversations).not.toContain('buildConversationDecisionTags')
    expect(callEligibility).toContain("from('sms_opt_outs')")
    expect(callEligibility).toContain("from('prospect_phones')")
    expect(callEligibility).toContain("from('lead_activities')")
    expect(callEligibility).not.toContain("from('manifests')")
    expect(callPolicy).not.toContain('DialerManifestPolicyFact')
  })
})
