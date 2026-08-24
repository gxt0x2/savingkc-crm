import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261003120000_canonical_ppc_attribution_backfill.sql',
  'utf8',
)

describe('canonical PPC attribution backfill migration', () => {
  it('copies only missing historical attribution into the internal tracking ledger', () => {
    expect(migration).toContain('INSERT INTO public.ppc_tracking_events')
    expect(migration).toContain("'backfill:manifest-attribution:' || candidate.lead_id::text")
    expect(migration).toContain("'legacy_attribution_backfill'")
    expect(migration).toContain("'historical_manifest_id', candidate.historical_manifest_id::text")
    expect(migration).toContain('NOT EXISTS (')
    expect(migration).toContain('FROM public.ppc_conversion_outbox AS existing_outbox')
    expect(migration).toContain('ON CONFLICT (event_id) DO NOTHING')
    expect(migration).not.toMatch(/INSERT INTO public\.ppc_conversion_outbox/i)
    expect(migration).not.toMatch(/UPDATE public\.manifests/i)
    expect(migration).not.toMatch(/DELETE FROM/i)
  })
})
