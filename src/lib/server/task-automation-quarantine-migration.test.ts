import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260908120000_task_automation_quarantine.sql'), 'utf8')

describe('task automation quarantine migration', () => {
  it('classifies only explicit unreviewed automation in the projection', () => {
    expect(sql).toContain("task_provenance_class_v1(NEW.source_metadata) = 'automation_unreviewed'")
    expect(sql).toContain("THEN 'quarantine'")
    expect(sql).toContain("CHECK (operational_lane IN ('current', 'review', 'quarantine'))")
    expect(sql).not.toMatch(/UPDATE\s+public\.lead_activities/i)
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.lead_activities/i)
  })

  it('keeps quarantine stable across lead lifecycle changes and supports the bounded lane query', () => {
    expect(sql).toContain("task_provenance_class_v1(source_metadata) <> 'automation_unreviewed'")
    expect(sql).toContain('UPDATE OF lead_id, source_metadata')
    expect(sql).toContain("'''operationalLane'', row.operational_lane")
    expect(sql).toContain("''current'', ''review'', ''quarantine'', ''all''")
  })

  it('preserves server-only access to the worklist RPC', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.task_worklist_page_v2[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.task_worklist_page_v2[\s\S]*TO service_role/)
  })
})
