import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260919120000_atomic_heir_skip_trace_sync.sql'),
  'utf8',
)

describe('atomic heir skip-trace migration contract', () => {
  it('owns replacement, evidence, and permissions in one server-only function', () => {
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain('DELETE FROM public.prospect_phones')
    expect(migration).toContain('INSERT INTO public.prospect_phones')
    expect(migration).toContain('INSERT INTO public.lead_activities')
    expect(migration).toContain("'action', 'sync_heirs'")
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.replace_heir_skip_trace_v1')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
  })
})
