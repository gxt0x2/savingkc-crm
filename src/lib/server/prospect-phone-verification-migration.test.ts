import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261014120000_prospect_phone_verification_columns.sql',
  'utf8',
)

describe('prospect phone verification repair migration', () => {
  it('repairs every verification field idempotently under bounded locks', () => {
    expect(migration).toContain("SET lock_timeout = '10s'")
    expect(migration).toContain("SET statement_timeout = '2min'")
    expect(migration).toContain('ALTER TABLE public.prospect_phones')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS is_verified_contact boolean NOT NULL DEFAULT false')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS verified_at timestamptz')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS verified_by text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS verified_source text')
  })

  it('restores the partial lookup index used by heir and campaign ranking', () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_prospect_phones_verified')
    expect(migration).toContain('ON public.prospect_phones (prospect_id)')
    expect(migration).toContain('WHERE is_verified_contact = true')
  })
})
