import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { POST as bulkReprocess } from '@/app/api/admin/reprocess-all-leads/route'
import { GET as lastReprocess, POST as reprocessLead } from '@/app/api/leads/[id]/reprocess/route'

const retiredFiles = [
  'src/lib/lead-pipeline.ts',
  'src/lib/lead-triage.ts',
  'scripts/reprocess-all-leads.mjs',
  'scripts/full-enrichment-backfill.mjs',
  'scripts/triage-existing-leads.mjs',
]

describe('Manifest reprocessing retirement', () => {
  it.each([
    ['single lead POST', reprocessLead, 'manifest_lead_reprocess_retired'],
    ['single lead GET', lastReprocess, 'manifest_lead_reprocess_retired'],
    ['bulk lead POST', bulkReprocess, 'manifest_bulk_reprocess_retired'],
  ])('returns a permanent canonical replacement for %s', async (_label, handler, code) => {
    const response = await handler()
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({ code })
  })

  it('removes the Manifest-only pipeline, triage classifier, and one-time drivers', () => {
    for (const path of retiredFiles) {
      expect(existsSync(path), path).toBe(false)
    }
  })

  it('catalogs the live canonical Mojo importer', () => {
    const catalog = readFileSync('src/lib/operating-model/workflow-catalog.ts', 'utf8')
    expect(catalog).toContain('src/lib/server/mojo-call-import.ts')
    expect(catalog).not.toContain('src/lib/lead-pipeline.ts')
  })
})
