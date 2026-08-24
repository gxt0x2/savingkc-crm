import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { POST as setStation } from './leads/[id]/station/route'
import { POST as repairStuckStations } from './stuck-stations/route'
import { POST as triageAll } from './triage-all/route'

const retiredRoutes = [
  'src/app/api/admin/leads/[id]/station/route.ts',
  'src/app/api/admin/stuck-stations/route.ts',
  'src/app/api/admin/triage-all/route.ts',
]

describe('Manifest repair endpoint retirement', () => {
  it.each([
    ['direct station mutation', setStation, 'admin_station_mutation_retired'],
    ['stuck-station repair', repairStuckStations, 'manifest_stuck_station_repair_retired'],
    ['bulk triage repair', triageAll, 'manifest_bulk_triage_repair_retired'],
  ])('returns a permanent replacement for %s', async (_label, handler, code) => {
    const response = await handler()
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({ code })
  })

  it('prevents the retired endpoints from regaining database or Manifest authority', () => {
    const source = retiredRoutes.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).not.toContain("from('leads')")
    expect(source).not.toContain("from('manifests')")
    expect(source).not.toContain('manifest-sync')
    expect(source).not.toContain('supabaseAdmin')
  })
})
