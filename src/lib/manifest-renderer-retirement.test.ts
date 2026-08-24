import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const retiredPaths = [
  'src/lib/manifest/render.ts',
  'src/lib/manifest/render.preCall.ts',
  'src/lib/manifest/schema.ts',
  'scripts/migration/99_acceptance.mts',
]

describe('orphan Manifest renderer retirement', () => {
  it('removes the unused renderer, schema, fixtures, and migration acceptance harness', () => {
    for (const path of retiredPaths) {
      expect(existsSync(path), path).toBe(false)
    }
  })

  it('removes stale npm and coverage references', () => {
    const packageSource = readFileSync('package.json', 'utf8')
    const vitestSource = readFileSync('vitest.config.ts', 'utf8')

    expect(packageSource).not.toContain('test:acceptance')
    expect(packageSource).not.toContain('99_acceptance')
    expect(vitestSource).not.toContain("'src/lib/manifest/**'")
  })
})
