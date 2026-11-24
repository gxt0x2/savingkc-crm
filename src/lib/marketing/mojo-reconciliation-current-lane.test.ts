import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261130150000_mojo_reconciliation_current_lane.sql'), 'utf8')

describe('mojo reconciliation current-lane migration', () => {
  it('scopes dead work items to the current lane with a guarded, idempotent patch', () => {
    expect(sql).toContain("'public.crm_mojo_reconciliation_snapshot_base_v1(timestamp with time zone)'::regprocedure")
    expect(sql).toContain("AND work.primary_next_action = true")
    expect(sql).toContain("AND work.operational_lane = ''current''")
    expect(sql).toMatch(/IF position\('work\.operational_lane' IN definition\) > 0 THEN\s+RETURN;/)
    expect(sql).toMatch(/RAISE EXCEPTION 'mojo reconciliation snapshot no longer matches/)
    expect(sql).not.toMatch(/mojo_call_queue/)
  })
})
