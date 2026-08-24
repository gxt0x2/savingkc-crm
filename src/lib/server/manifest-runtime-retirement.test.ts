import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function runtimeSourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...runtimeSourceFiles(path))
      continue
    }
    if (!['.ts', '.tsx'].includes(extname(entry.name))) continue
    if (/\.(?:test|spec)\.[^.]+$/.test(entry.name)) continue
    files.push(path)
  }
  return files
}

describe('Manifest runtime retirement', () => {
  it('removes the orphan writer, builder, and enrichment libraries', () => {
    for (const path of [
      'src/lib/manifest-sync.ts',
      'src/lib/manifest-builder.ts',
      'src/lib/manifest-enrichment.ts',
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(false)
    }
  })

  it('keeps application runtime code free of Manifest storage and library dependencies', () => {
    const violations = runtimeSourceFiles('src')
      .map((path) => ({ path, source: readFileSync(resolve(root, path), 'utf8') }))
      .filter(({ source }) => (
        /manifest-(?:sync|builder|enrichment)/.test(source) ||
        /\.from\(['"]manifests['"]\)/.test(source)
      ))
      .map(({ path }) => relative(root, resolve(root, path)))

    expect(violations).toEqual([])
  })

  it('retains explicit no-store tombstones until the historical table is archived', () => {
    const collection = readFileSync(resolve(root, 'src/app/api/manifests/route.ts'), 'utf8')
    const item = readFileSync(resolve(root, 'src/app/api/manifests/[id]/route.ts'), 'utf8')
    const bootstrap = readFileSync(resolve(root, 'src/app/api/leads/ensure-manifest/route.ts'), 'utf8')

    expect(`${collection}\n${item}`).toContain("code: 'legacy_manifest_api_retired'")
    expect(bootstrap).toContain('Manifest bootstrap is retired')
    expect(`${collection}\n${item}\n${bootstrap}`).toContain('status: 410')
    expect(`${collection}\n${item}\n${bootstrap}`).toContain('no-store')
  })
})
