import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260829120000_dialer_pre_call_brief_security.sql', 'utf8')

describe('dialer pre-call brief security migration', () => {
  it('moves briefing and co-owner context behind server routes', () => {
    for (const table of ['briefings', 'lead_co_owners']) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`)
      expect(migration).toContain(`GRANT ALL ON TABLE public.${table} TO service_role`)
    }
  })
})
