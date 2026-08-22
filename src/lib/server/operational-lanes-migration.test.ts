import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260906120000_operational_review_lanes.sql'), 'utf8')

describe('operational review lane migration', () => {
  it('keeps the rollout additive and service-role only', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS operational_lane')
    expect(sql).toContain('task_worklist_page_v2')
    expect(sql).toContain('conversation_thread_page_v2')
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.task_worklist_page_v2[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.conversation_thread_page_v2[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|SCHEMA)/i)
  })

  it('maintains and indexes current versus review work', () => {
    expect(sql).toContain("CHECK (operational_lane IN ('current', 'review'))")
    expect(sql).toContain('trigger_set_work_item_operational_lane_v1')
    expect(sql).toContain('trigger_sync_work_item_operational_lane_from_lead_v1')
    expect(sql).toContain('idx_work_items_operational_lane_due')
    expect(sql).toContain("'laneCounts'")
  })

  it('supports indexed known and unmatched inbox reads', () => {
    expect(sql).toContain('idx_conversation_thread_state_known_inbox')
    expect(sql).toContain('idx_conversation_thread_state_unmatched_inbox')
    expect(sql).toContain("clean_kind NOT IN ('all', 'known', 'unmatched')")
    expect(sql).toContain("clean_kind = 'known' AND thread.lead_id IS NOT NULL")
    expect(sql).toContain("clean_kind = 'unmatched' AND thread.lead_id IS NULL")
  })
})
