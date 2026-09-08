import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Mojo incident schema repair', () => {
  it('adds the metadata column idempotently for legacy briefing tables', () => {
    const migration = fs.readFileSync('supabase/migrations/20260908220000_ari_briefing_event_metadata.sql', 'utf8')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS metadata jsonb')
    expect(migration).toContain('ALTER COLUMN metadata SET NOT NULL')
    expect(migration).toContain("metadata->>'system'")
  })
})
