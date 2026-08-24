import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tcSource = readFileSync('src/lib/tc.ts', 'utf8')
const tcRouteSource = readFileSync('src/app/api/tc/files/[id]/route.ts', 'utf8')

describe('canonical closing coordination source', () => {
  it('keeps TC files, tasks, events, and revenue authoritative without Manifest mirroring', () => {
    expect(tcSource).toContain("'tc_files'")
    expect(tcSource).toContain("'tc_tasks'")
    expect(tcSource).toContain("'tc_events'")
    expect(tcSource).toContain("'revenue_transactions'")
    expect(tcSource).not.toContain('@/lib/manifest-sync')
    expect(tcSource).not.toContain('syncTcStatusToManifest')
    expect(tcRouteSource).not.toContain('syncTcStatusToManifest')
  })
})
