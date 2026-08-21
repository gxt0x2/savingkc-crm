import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = join(process.cwd(), 'supabase/migrations/20260902120000_contact_workspace_page.sql')

describe('contact directory migration', () => {
  it('keeps the page bounded, indexed, and service-role-only', async () => {
    const migration = await readFile(migrationPath, 'utf8')
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_manifests_lead_latest')
    expect(migration).toContain('LIMIT capped_limit + 1')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.contact_workspace_page_v1')
    expect(migration).toContain('TO service_role;')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated;')
    expect(migration).not.toContain('OFFSET ')
  })
})
