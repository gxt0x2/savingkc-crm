import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260821120000_work_items_projection.sql'),
  'utf8',
)

describe('canonical work-item migration contract', () => {
  it('projects both durable task sources without deleting either source', () => {
    expect(migration).toContain("source_kind IN ('activity', 'tc_task')")
    expect(migration).toContain('trigger_sync_activity_work_item_v1')
    expect(migration).toContain('trigger_sync_tc_task_work_item_v1')
    expect(migration).not.toMatch(/DROP TABLE\s+(?:public\.)?(?:tasks|lead_activities|tc_tasks)/i)
  })

  it('keeps task state and mutation functions server-only', () => {
    expect(migration).toContain('ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE public.work_items FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('REVOKE ALL ON TABLE public.work_item_events FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.create_work_item_v1')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.transition_work_item_v1')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.transition_work_items_bulk_v1')
  })

  it('makes individual and bulk mutations idempotent, audited, and transactional', () => {
    expect(migration).toContain('idempotency_key text NOT NULL UNIQUE')
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('work-item:' || p_work_item_key, 0))")
    expect(migration).toContain('INSERT INTO public.work_item_events')
    expect(migration).toContain('FOREACH item_key IN ARRAY clean_keys LOOP')
    expect(migration).toContain("clean_key || ':' || md5(item_key)")
  })

  it('contains malformed legacy dates and bounds bulk input', () => {
    expect(migration).toContain('EXCEPTION WHEN OTHERS')
    expect(migration).toContain("RAISE EXCEPTION 'too_many_work_items'")
    expect(migration).toContain('LIMIT 201')
  })
})
