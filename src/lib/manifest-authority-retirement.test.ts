import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('Manifest operational-authority retirement', () => {
  it('records canonical authority and a staged, non-destructive retirement', () => {
    const plan = source('docs/manifest-retirement-plan.md')
    expect(plan).toContain('Manifest is being retired as an operational source of truth')
    expect(plan).toContain('Canonical systems win every conflict')
    expect(plan).toContain('Do not delete yet')
  })

  it('keeps the new county audience and owner-assignment paths Manifest-free', () => {
    const canonicalSlice = [
      source('src/lib/server/county-prospect-audiences.ts'),
      source('src/app/api/prospecting/county-audiences/route.ts'),
      source('src/components/prospecting/county-audience-inventory.tsx'),
      source('src/components/contacts/contact-owner-assignment.tsx'),
    ].join('\n')
    expect(canonicalSlice).not.toMatch(/manifest/i)
  })
})
