import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20261112120000_park_spam_cold_caller_ids.sql',
), 'utf8')

const parked = ['+18162538313', '+18166408032', '+18163100845', '+18164761589']
const stillOutbound = ['+18166404701', '+18165788107', '+18166536616', '+18164761344']

describe('park spam cold caller ids migration', () => {
  it('replaces the prospecting allowlist with the four remaining cold lines', () => {
    const replacement = migration.match(/\$array\$([\s\S]*)\$array\$/)?.[1] ?? ''
    expect(replacement).toBe("allowed_caller_ids constant text[] := ARRAY['+18166404701', '+18165788107', '+18166536616', '+18164761344'];")
    for (const number of stillOutbound) expect(replacement).toContain(number)
    for (const number of parked) expect(replacement).not.toContain(number)
  })

  it('fails closed when the live allowlist has drifted and does not release numbers', () => {
    expect(migration).toContain('start_prospecting_dialer_session_v4_missing')
    expect(migration).toContain('unexpected_start_prospecting_dialer_session_v4_caller_allowlist')
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP TABLE|UPDATE public\.)\b/)
    expect(migration).toContain('Twilio ownership and inbound callback routing stay')
    expect(migration).toContain('do not release')
  })

  it('keeps session start server-only', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4')
    expect(migration).toContain('TO service_role')
  })
})
