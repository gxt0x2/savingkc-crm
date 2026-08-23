import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('legacy browser database surface retirement', () => {
  it('keeps unreferenced client-side query surfaces deleted', () => {
    const retiredFiles = [
      'src/components/checklist/history-table.tsx',
      'src/components/feedback/sprint-burndown-chart.tsx',
      'src/components/mail/mail-batch-view.tsx',
      'src/hooks/use-supabase.ts',
      'src/hooks/use-deals.ts',
      'src/hooks/use-contacts.ts',
      'src/hooks/use-activities.ts',
      'src/hooks/use-dashboard.ts',
    ]

    for (const file of retiredFiles) expect(existsSync(file)).toBe(false)
  })
})
