import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/app/(app)/leads/[id]/page.tsx', 'utf8')

describe('lead workspace retirement boundary', () => {
  it('keeps the canonical workspace and removes the unreachable legacy cockpit', () => {
    expect(source).toContain('<LeadWorkspace')
    expect(source).not.toContain('{false &&')
    expect(source).not.toContain('function LeadTriageStrip')
    expect(source).not.toContain('function NetProceedsCalc')
    expect(source).not.toContain('function EmailComposeModal')
    expect(source).not.toContain('function ManifestPanel')
    expect(source).not.toContain("fetch('/api/manifests")
  })

  it('prevents the retired duplicate surface from regrowing inside the route', () => {
    expect(source.split('\n').length).toBeLessThan(1_500)
  })
})
