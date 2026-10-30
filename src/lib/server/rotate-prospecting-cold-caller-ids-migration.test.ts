import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20261130120000_rotate_prospecting_cold_caller_ids.sql',
), 'utf8')

const prospecting = ['+18166088770', '+18166088552', '+18166088559', '+18166086999']
const parked20261030 = ['+18164761344', '+18166404701', '+18165788107', '+18166536616']
const parked20260923 = ['+18162538313', '+18166408032', '+18163100845', '+18164761589']
const gertha = '+18166086699'

describe('rotate prospecting cold caller ids migration', () => {
  it('replaces the prospecting allowlist with the four new cold lines', () => {
    const replacement = migration.match(/\$array\$([\s\S]*)\$array\$/)?.[1] ?? ''
    expect(replacement).toBe("allowed_caller_ids constant text[] := ARRAY['+18166088770', '+18166088552', '+18166088559', '+18166086999'];")
    for (const number of prospecting) expect(replacement).toContain(number)
    for (const number of [...parked20261030, ...parked20260923, gertha]) {
      expect(replacement).not.toContain(number)
    }
  })

  it('fails closed when the live allowlist has drifted and does not drop tables', () => {
    expect(migration).toContain('start_prospecting_dialer_session_v4_missing')
    expect(migration).toContain('unexpected_start_prospecting_dialer_session_v4_caller_allowlist')
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP TABLE|UPDATE public\.)\b/)
    expect(migration).toContain('CRM phone inventory')
    expect(migration).toContain('Twilio number release is outside this migration')
    expect(migration).toContain('Gertha Dotson (Admin/TC)')
    for (const number of [...parked20261030, ...parked20260923]) expect(migration).toContain(number)
  })

  it('keeps session start server-only', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4')
    expect(migration).toContain('TO service_role')
  })
})
