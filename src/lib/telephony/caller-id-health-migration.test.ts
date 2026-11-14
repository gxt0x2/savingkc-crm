import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20261203120000_caller_id_health.sql',
), 'utf8')
const db = readFileSync(join(process.cwd(), 'src/lib/telephony/caller-id-health-db.ts'), 'utf8')
const routes = [
  readFileSync(join(process.cwd(), 'src/app/api/cron/caller-id-health/route.ts'), 'utf8'),
  readFileSync(join(process.cwd(), 'src/app/api/admin/caller-id-health/route.ts'), 'utf8'),
].join('\n')

describe('caller id health migration', () => {
  it('adds inventory status, rest_until, and a health event log', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.caller_ids')
    expect(migration).toContain('rest_until timestamptz')
    expect(migration).toContain("status IN ('active', 'spare', 'resting', 'held')")
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.caller_id_health_events')
    expect(migration).toContain('quality pause')
    expect(migration).toContain('do not release')
    expect(migration).toContain('ON CONFLICT (phone_e164) DO NOTHING')
    expect(migration).toContain("'+18166404701', '816', 'active'")
    expect(migration).toContain("'+18164761344', '816', 'spare'")
    expect(migration).toContain("'+18162538313', '816', 'held'")
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS caller_id text')
    expect(migration).toContain('caller_id_value')
    expect(migration).toContain('COALESCE(EXCLUDED.caller_id, public.crm_mojo_calls.caller_id)')
    expect(migration.indexOf('CREATE OR REPLACE FUNCTION public.caller_id_health_replace_once')).toBeLessThan(migration.indexOf('DO $patch$'))
    expect(migration).toContain('DROP FUNCTION public.caller_id_health_replace_once')
  })

  it('stays additive and does not touch the dialer import queue or invent a cron secret', () => {
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
    expect(migration).not.toMatch(/mojo_call_queue/)
    expect(migration).not.toMatch(/CRON_SECRET/)
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE public.caller_ids FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.caller_id_health_events TO service_role')
  })

  it('reads stored CRM calls and does not call Mojo or Twilio', () => {
    expect(db).toContain(".from('crm_mojo_calls')")
    expect(db).toContain(".from('lead_activities')")
    expect(db).toContain('twilio_status_callback')
    expect(db).not.toMatch(/mojo_call_queue|api\.twilio\.com|mojosells|CRON_SECRET/)
    expect(db).toContain(".eq('status', 'active')")
    expect(db).toContain(".eq('status', 'spare')")
    expect(routes).toContain('requireAdminOrSecret')
    expect(routes).not.toMatch(/CRON_SECRET|mojo_call_queue|api\.twilio\.com|mojosells/)
  })
})
