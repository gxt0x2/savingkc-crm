import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const definitions = readFileSync('src/lib/stage-logic.ts', 'utf8')
const automaticLifecycle = readFileSync('src/lib/pipeline-auto-advance.ts', 'utf8')
const legacyRoute = readFileSync('src/app/api/stage/advance/route.ts', 'utf8')

describe('legacy stage mutation retirement', () => {
  it('keeps stage definitions data-only', () => {
    expect(definitions).toContain('STAGE_DEFINITIONS')
    expect(definitions).not.toContain('createClient')
    expect(definitions).not.toContain('manifest-sync')
    expect(definitions).not.toContain('advanceLeadStage')
    expect(definitions).not.toContain('migrateLeadsWithoutStage')
  })

  it('keeps both human and automatic lifecycle changes on the governed boundary', () => {
    expect(legacyRoute).toContain('legacy_stage_route_retired')
    expect(legacyRoute).toContain('/api/leads/[id]/lifecycle')
    expect(automaticLifecycle).toContain('applyCrmLifecycleCommand')
  })
})
