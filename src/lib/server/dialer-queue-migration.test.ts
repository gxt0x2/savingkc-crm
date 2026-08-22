import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260905120000_dialer_queue_read_model.sql', 'utf8')

describe('dialer queue read model migration', () => {
  it('keeps source truth immutable and request reads bounded', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.dialer_queue_state')
    expect(migration).toContain('LEAST(GREATEST(COALESCE(target_limit, 1000), 1), 1000)')
    expect(migration).toContain('LIMIT (SELECT capped_limit FROM settings)')
    expect(migration).toContain('idx_dialer_queue_daily_calls')
    expect(migration).toContain('public.normalize_conversation_phone(opt_out.phone)')
    expect(migration).toContain('AND NOT EXISTS (')
    expect(migration).not.toMatch(/DELETE FROM public\.lead_activities/i)
    expect(migration).not.toMatch(/UPDATE public\.lead_activities/i)
  })

  it('protects the projection and RPC from browser roles', () => {
    expect(migration).toContain('ALTER TABLE public.dialer_queue_state ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE public.dialer_queue_state FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.dialer_queue_page_v1(INTEGER, UUID[], TIMESTAMPTZ)')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.dialer_queue_page_v1(INTEGER, UUID[], TIMESTAMPTZ)')
    expect(migration).toContain('TO service_role')
  })

  it('serializes runtime refreshes without retaining one lock per backfilled lead', () => {
    expect(migration).toContain("hashtextextended('dialer_queue_state:backfill', 0)")
    expect(migration).toContain('refresh_dialer_queue_state_core(lead.id)')
    expect(migration).not.toContain('refresh_dialer_queue_state(lead.id)')
  })
})
