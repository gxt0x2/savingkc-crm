import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GET as appointmentStats } from '@/app/api/dashboard/appointment-stats/route'

const canonicalSources = [
  'src/lib/agent-scorecard.ts',
  'src/lib/agent-stats.ts',
  'src/lib/operating-rhythm.ts',
]

describe('Manifest analytics retirement', () => {
  it('removes unused Manifest-derived score, appointment, and show-rate analytics', () => {
    const source = canonicalSources.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).not.toContain("from('manifests')")
    expect(source).not.toContain('getGhostRiskValidation')
    expect(source).not.toContain('getAppointmentStats')
    expect(source).not.toContain('runShowRateAlerts')
  })

  it('directs the unused dashboard endpoint to canonical operating reporting', async () => {
    const response = await appointmentStats()
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      code: 'manifest_appointment_dashboard_retired',
      replacement: '/api/reports/operating?period=30d',
    })
  })
})
