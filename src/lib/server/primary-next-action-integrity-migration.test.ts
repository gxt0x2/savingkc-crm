import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260910120000_primary_next_action_integrity.sql'
const sql = readFileSync(migrationPath, 'utf8')

describe('primary next-action integrity migration', () => {
  it('uses the canonical active-opportunity definition for counts and enforcement', () => {
    expect(sql).toContain('contact_workspace_normalize_stage(lead.station)')
    expect(sql).toContain('contact_workspace_pipeline_intent_source(')
    expect(sql).toContain("normalized.classification IN ('lead', 'opportunity')")
    expect(sql).toContain("normalized.station IN ('qualified', 'appointment_set', 'offer_made', 'under_contract')")
    expect(sql).toContain('coalesce(lead.is_parked, false) = false')
  })

  it('serializes and blocks only newly created duplicate current primaries', () => {
    expect(sql).toContain("hashtextextended('primary-next-action:' || first_lock::text, 0)")
    expect(sql).toContain("item.operational_lane = 'current'")
    expect(sql).toContain("item.status IN ('pending', 'blocked')")
    expect(sql).toContain('item.primary_next_action = true')
    expect(sql).toContain('FROM public.lead_activities AS activity')
    expect(sql).toContain('idx_lead_activities_primary_candidate_by_lead')
    expect(sql).toContain("RAISE EXCEPTION 'primary_next_action_exists'")
    expect(sql).toContain('OLD.lead_id = NEW.lead_id')
  })

  it('keeps existing task records untouched and server-only', () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.(lead_activities|work_items)/i)
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.(lead_activities|work_items)/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.primary_next_action_integrity_summary_v1\(\)[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.primary_next_action_integrity_summary_v1\(\)[\s\S]*TO service_role/)
  })

  it('keeps relinked source tasks synchronized with the projection', () => {
    expect(sql).toContain('AFTER INSERT OR UPDATE OF lead_id, activity_type, description, agent, metadata OR DELETE')
  })
})
