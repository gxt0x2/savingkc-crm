import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260926120000_crm_lead_offer_command.sql')
const source = fs.readFileSync(migrationPath, 'utf8')

describe('canonical lead offer migration', () => {
  it('records amount, lifecycle, and timeline evidence in one database command', () => {
    expect(source).toContain('CREATE OR REPLACE FUNCTION public.record_crm_lead_offer_v1')
    expect(source).toContain('pg_advisory_xact_lock')
    expect(source).toContain('public.crm_apply_lifecycle_command_v1')
    expect(source).toContain("activity_type = 'offer'")
    expect(source).toContain("'source', 'canonical_offer_v1'")
    expect(source).toContain('previous_amount')
  })

  it('is idempotent, service-only, and does not write Manifest compatibility state', () => {
    expect(source).toContain('idx_lead_activities_canonical_offer_command')
    expect(source).toContain("RAISE EXCEPTION 'offer_command_conflict'")
    expect(source).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(source).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/)
    expect(source).not.toMatch(/\bmanifests?\b/i)
  })
})
