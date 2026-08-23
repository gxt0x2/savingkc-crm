import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260912120000_primary_next_action_human_resolution.sql',
  'utf8',
)

describe('primary next-action human resolution migration', () => {
  it('keeps review and mutation server-only', () => {
    for (const signature of [
      'primary_next_action_review_v1(uuid)',
      'resolve_primary_next_action_v1(uuid, text, text, text, text, integer, text, text, text, timestamptz, text)',
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${signature}`)
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${signature}`)
    }
    expect(migration.match(/FROM PUBLIC, anon, authenticated/g)).toHaveLength(2)
    expect(migration.match(/TO service_role/g)).toHaveLength(2)
  })

  it('only offers current operator-created activity tasks', () => {
    expect(migration).toContain("item.operational_lane = 'current'")
    expect(migration).toContain("item.status IN ('pending', 'blocked')")
    expect(migration).toContain("item.source_kind = 'activity'")
    expect(migration).toContain("item.provenance_class IN ('governed_human', 'legacy_operator')")
    expect(migration).not.toMatch(/FROM public\.manifests/i)
    expect(migration).not.toMatch(/ai_generation_id/i)
  })

  it('serializes one-lead decisions and rejects duplicate or stale primaries', () => {
    expect(migration).toContain("hashtextextended('primary-next-action:' || p_lead_id::text, 0)")
    expect(migration).toContain("RAISE EXCEPTION 'primary_next_action_exists'")
    expect(migration).toContain("RAISE EXCEPTION 'work_item_version_conflict'")
    expect(migration).toContain("RAISE EXCEPTION 'primary_candidate_selection_required'")
  })

  it('records explicit human provenance and one immutable event', () => {
    expect(migration).toContain("'human_selected_existing_v1'")
    expect(migration).toContain("'human_created_v1'")
    expect(migration).toContain("'select_primary_next_action'")
    expect(migration).toContain("'create_primary_next_action'")
    expect(migration).toContain("'primary_next_action_human_resolution_v1'")
  })
})
