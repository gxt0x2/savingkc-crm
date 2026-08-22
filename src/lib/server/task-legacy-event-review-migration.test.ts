import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260909120000_task_legacy_event_review.sql'
const sql = readFileSync(migrationPath, 'utf8')

describe('legacy task event-review migration', () => {
  it('matches only the approved communication-event evidence signatures', () => {
    expect(sql).toContain("metadata_signature = 'assigned_to,due_date,priority,status,task_type'")
    expect(sql).toContain("metadata_signature = 'assigned_to,due_date,priority,seller_phone,status,task_type'")
    expect(sql).toContain("metadata_signature = 'assigned_to,due_date,priority,recordingUrl,status,task_type'")
    expect(sql).toContain("activity_agent = 'System'")
    expect(sql).toContain("activity_agent = 'Ari'")
    expect(sql).toContain("item.due_at <= item.source_created_at + interval '15 minutes'")
    expect(sql).toContain("shaped.source_created_at - interval '5 seconds'")
    expect(sql).toContain("shaped.source_created_at + interval '5 seconds'")
  })

  it('fails closed unless the approved 52 plus 15 plus 4 census is intact', () => {
    expect(sql).toContain('candidate_total <> 71')
    expect(sql).toContain('generic_total <> 52')
    expect(sql).toContain('seller_phone_total <> 15')
    expect(sql).toContain('recording_total <> 4')
    expect(sql).toContain('unknown_active_total <> 75')
    expect(sql).toContain('unknown_active_total <> 4')
  })

  it('adds durable event provenance and keeps the corrected rows review-only', () => {
    expect(sql).toContain("'event_activity_id', candidate.event_activity_id::text")
    expect(sql).toContain("'legacy_event_review', true")
    expect(sql).toContain("'provenance_correction', 'task_legacy_event_review_v1'")
    expect(sql).toContain("'event_activity_id'")
    expect(sql).toContain("source_metadata ->> 'legacy_event_review'")
    expect(sql).toContain("THEN 'review'")
    expect(sql).toContain('event_backed_total <> 71')
    expect(sql).toContain('review_total <> 71')
  })

  it('updates source metadata without changing task state or content', () => {
    expect(sql).toContain('UPDATE public.lead_activities AS activity')
    expect(sql).toMatch(/SET metadata = jsonb_strip_nulls\(/)
    expect(sql).not.toMatch(/SET\s+(status|description|agent)\s*=/i)
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.(lead_activities|work_items)/i)
  })
})

