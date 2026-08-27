import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const originalMigration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20261019120000_prospecting_dialer_session_setup.sql',
), 'utf8')

const repairMigration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20261021120000_fix_prospecting_dialer_resume_session.sql',
), 'utf8')

describe('prospecting dialer resume-session repair migration', () => {
  it('qualifies both ambiguous V4 checks without depending on indentation', () => {
    expect(originalMigration.match(/WHERE session_id = open_session\.id/g)).toHaveLength(2)
    expect(repairMigration).toContain('occurrence_count <> 2')
    expect(repairMigration).toContain("broken_fragment constant text := 'WHERE session_id = open_session.id'")
    expect(repairMigration).toContain('WHERE dialer_session_attempts.session_id = open_session.id')
    expect(repairMigration).not.toContain('FROM public.dialer_session_attempts\\n')
  })

  it('fails closed if the production function has drifted', () => {
    expect(repairMigration).toContain('start_prospecting_dialer_session_v4_missing')
    expect(repairMigration).toContain('unexpected_start_prospecting_dialer_session_v4_definition')
  })

  it('changes only the function definition and preserves server-only execution', () => {
    expect(repairMigration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP TABLE|UPDATE public\.)\b/)
    expect(repairMigration).toContain('REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4')
    expect(repairMigration).toContain('TO service_role')
  })
})
