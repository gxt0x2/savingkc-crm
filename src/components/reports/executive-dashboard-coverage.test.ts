import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const dashboard = readFileSync('src/components/reports/executive-dashboard.tsx', 'utf8')

describe('executive dashboard data coverage', () => {
  it('shows incomplete operating sources instead of presenting partial counts as clean zeros', () => {
    expect(dashboard).toContain('Object.entries(report.availability)')
    expect(dashboard).toContain('Partial data:')
    expect(dashboard).toContain('does not replace missing records with sample values')
  })
})
