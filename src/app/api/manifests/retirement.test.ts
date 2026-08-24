import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GET as getCollection, POST as createManifest } from './route'
import { GET as getManifest, PATCH as updateManifest } from './[id]/route'

const routeFiles = [
  'src/app/api/manifests/route.ts',
  'src/app/api/manifests/[id]/route.ts',
]

describe('legacy Manifest API retirement', () => {
  it.each([
    ['collection GET', getCollection],
    ['collection POST', createManifest],
    ['item GET', getManifest],
    ['item PATCH', updateManifest],
  ])('returns a permanent canonical replacement for %s', async (_label, handler) => {
    const response = await handler()
    expect(response.status).toBe(410)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toMatchObject({
      code: 'legacy_manifest_api_retired',
    })
  })

  it('cannot read, create, or mutate Manifest storage', () => {
    const source = routeFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).not.toContain('supabase')
    expect(source).not.toContain("from('")
    expect(source).not.toContain('manifest-builder')
    expect(source).not.toContain('manifest-sync')
  })

  it('removes the obsolete compatibility logger', () => {
    expect(existsSync('src/lib/server/legacy-manifest-api.ts')).toBe(false)
  })
})
