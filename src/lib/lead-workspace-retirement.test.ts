import { existsSync, readFileSync } from 'node:fs'
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

  it('removes the orphaned component files that only served the retired cockpit', () => {
    const retiredFiles = [
      'src/components/leads/add-lead-modal.tsx',
      'src/components/leads/favorite-toggle.tsx',
      'src/components/leads/temperature-badge.tsx',
      'src/components/leads/temperature-override.tsx',
      'src/components/leads/thank-you-card.tsx',
      'src/components/leads/missing-info-card.tsx',
      'src/components/leads/seller-goals.tsx',
      'src/components/leads/ari-chat.tsx',
      'src/components/ui/sortable-column.tsx',
    ]

    for (const file of retiredFiles) expect(existsSync(file)).toBe(false)
  })
})
