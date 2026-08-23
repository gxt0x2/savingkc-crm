import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260913120000_phase_zero_current_work_only.sql',
  'utf8',
)

describe('Phase Zero current-work boundary migration', () => {
  it('keeps human and approved workflow work current while retiring generated rows', () => {
    expect(migration).toContain("provenance_class IN ('automation_unreviewed', 'unknown') THEN 'quarantine'")
    expect(migration).toContain("provenance_class = 'event_derived' THEN 'review'")
    expect(migration).toContain("provenance_class IN ('approved_workflow', 'governed_human', 'legacy_operator')")
    expect(migration).toContain("NOT IN ('dead', 'closed', 'closed_lost')")
  })

  it('reclassifies only the projection and preserves source evidence', () => {
    expect(migration).toContain('UPDATE public.work_items AS item')
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.(lead_activities|tc_tasks)/i)
    expect(migration).not.toMatch(/UPDATE\s+public\.(lead_activities|tc_tasks)/i)
  })

  it('keeps trigger functions service-role only', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
  })

  it('enforces the current lane again inside the canonical database transition', () => {
    expect(migration).toContain('RENAME TO transition_work_item_unchecked_v1')
    expect(migration).toContain("lane_value IS DISTINCT FROM 'current'")
    expect(migration).toContain("RAISE EXCEPTION 'work_item_not_current'")
  })
})
