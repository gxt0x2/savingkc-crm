import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const operatorSources = [
  'src/app/(app)/leads/[id]/page.tsx',
  'src/components/leads/add-note.tsx',
  'src/components/leads/contract-modal.tsx',
  'src/components/telephony/telephony-bar.tsx',
]

describe('legacy broad lead PATCH retirement', () => {
  it('keeps active operator writes on typed per-contact endpoints', () => {
    const source = operatorSources.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).not.toMatch(/fetch\(['"]\/api\/leads['"][\s\S]{0,500}?method:\s*['"]PATCH/)
    expect(source).toContain('/api/leads/${lead.id}`')
    expect(source).toContain('/disposition`')
  })

  it('keeps the compatibility switch fail-closed in production', () => {
    const route = readFileSync('src/app/api/leads/route.ts', 'utf8')
    expect(route).toContain("process.env.ENABLE_LEGACY_LEADS_PATCH === 'true'")
    expect(route).toContain("process.env.NODE_ENV !== 'production'")
    expect(route).toContain("process.env.VERCEL_ENV !== 'production'")
    expect(route).toContain('legacy_leads_patch_retired')
  })
})
