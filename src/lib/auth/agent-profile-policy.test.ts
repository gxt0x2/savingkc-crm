import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260818_agent_profiles_server_only.sql'

describe('agent profile database containment', () => {
  it('removes direct browser-role access and preserves service-role access', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    for (const policyName of [
      'Authenticated full access',
      'Authenticated users can read profiles',
      'Users can update own profile',
      'authenticated_all',
    ]) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${policyName}" ON public.agent_profiles`)
    }
    expect(sql).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.agent_profiles FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/GRANT ALL PRIVILEGES ON TABLE public\.agent_profiles TO service_role/i)
    expect(sql).toMatch(/grantee IN \('PUBLIC', 'anon', 'authenticated'\)/i)
    expect(sql).toMatch(/'authenticated' = ANY \(roles\)/i)
    expect(sql).not.toMatch(/TO authenticated\b/i)
  })
})
