import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260904130000_prospecting_dialer_batches.sql'), 'utf8')

describe('prospecting dialer batches migration', () => {
  it('claims bounded batches atomically and keeps the dialer single-line', () => {
    expect(migration).toContain('LIMIT 100')
    expect(migration).toContain("pg_advisory_xact_lock(pg_catalog.hashtextextended('dialer-actor:'")
    expect(migration).toContain('public.start_dialer_session_v1(')
    expect(migration).toContain("'batch_size', cardinality(lead_ids)")
  })

  it('projects worked calls and releases unfinished contacts', () => {
    expect(migration).toContain("NEW.event_type <> 'lead_completed'")
    expect(migration).toContain("SET status = 'completed'")
    expect(migration).toContain("NEW.status IN ('completed', 'stopped')")
    expect(migration).toContain('SET dialer_session_id = NULL')
    expect(migration).toContain('campaign_member_in_active_dialer_batch')
  })

  it('keeps every new boundary service-role only', () => {
    expect(migration.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(4)
    expect(migration.match(/TO service_role/g)).toHaveLength(4)
    expect(migration).toContain('idx_prospecting_campaign_members_next_dialer_batch')
  })
})
