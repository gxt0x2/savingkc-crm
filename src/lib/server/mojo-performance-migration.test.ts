import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  'supabase/migrations/20261013120000_mojo_daily_performance.sql',
  'utf8',
)

describe('Mojo daily performance migration contract', () => {
  it('keeps the provider projection private and service-role only', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.mojo_agent_daily_performance')
    expect(migration).toContain('ALTER TABLE public.mojo_agent_daily_performance ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain('SET search_path = pg_catalog, public')
  })

  it('serializes exact-day upserts and prevents stale provider snapshots from winning', () => {
    expect(migration).toContain("'mojo-performance:' || agent_value || ':' || date_value::text")
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock')
    expect(migration).toContain('ON CONFLICT (agent_key, metric_date) DO UPDATE')
    expect(migration).toContain('WHERE EXCLUDED.source_fetched_at > public.mojo_agent_daily_performance.source_fetched_at')
    expect(migration).toContain("source = 'mojo_kpi_historical_daily_v1'")
  })
})
