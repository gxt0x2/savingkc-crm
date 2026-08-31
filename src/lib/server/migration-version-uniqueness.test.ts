import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Supabase migration versions', () => {
  it('keeps every timestamped migration version unique', () => {
    const directory = join(process.cwd(), 'supabase', 'migrations')
    const versions = readdirSync(directory)
      .map((file) => file.match(/^(\d{14})_.*\.sql$/)?.[1])
      .filter((version): version is string => Boolean(version))
    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index)

    expect(Array.from(new Set(duplicates)), 'Duplicate migration versions prevent deterministic production schema updates').toEqual([])
  })
})
