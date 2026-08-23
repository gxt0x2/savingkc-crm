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

  it('keeps the compatibility writer unconditionally retired', () => {
    const route = readFileSync('src/app/api/leads/route.ts', 'utf8')
    const retirement = readFileSync('src/lib/server/legacy-leads-patch-retirement.ts', 'utf8')
    expect(route).toContain('retiredLegacyLeadsPatchResponse()')
    expect(retirement).toContain('legacy_leads_patch_retired')
    expect(retirement).not.toContain('process.env')
  })
})
