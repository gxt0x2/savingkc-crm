import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const files = [
  'src/app/(app)/contacts/page.tsx',
  'src/app/(app)/leads/[id]/page.tsx',
  'src/app/(app)/dialer/page.tsx',
  'src/components/leads/lead-status-control.tsx',
  'src/components/leads/stage-selector.tsx',
  'src/components/leads/contract-modal.tsx',
  'src/components/telephony/telephony-bar.tsx',
]

describe('operator lifecycle UI trust boundary', () => {
  it('routes lifecycle changes through the governed command endpoint', () => {
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).toContain('/lifecycle')
    expect(source).not.toMatch(/fetch\(['"]\/api\/leads['"][\s\S]{0,500}?station\s*:/)
    expect(source).not.toContain('/api/admin/leads/${leadId}/station')
  })

  it('does not let operator clients supply lifecycle actor identity', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const lifecycleCalls = source.split('/lifecycle').slice(1)
      for (const call of lifecycleCalls) {
        expect(call.slice(0, 700)).not.toMatch(/actor(?:Email|Name)?\s*:/)
      }
    }
  })

  it('routes the active dialer outcome through the typed per-lead endpoint', () => {
    const source = readFileSync('src/components/telephony/telephony-bar.tsx', 'utf8')
    expect(source).toContain('/disposition`')
    expect(source).not.toMatch(/fetch\(['"]\/api\/leads['"][\s\S]{0,500}?disposition/)
  })
})
