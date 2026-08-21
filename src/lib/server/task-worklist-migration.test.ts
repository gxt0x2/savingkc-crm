import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = [
  '20260830120000_task_worklist_read_model.sql',
  '20260830123000_task_worklist_query_plan.sql',
].map((file) => fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', file), 'utf8')).join('\n')

describe('task worklist migration contract', () => {
  it('keeps the RPC service-only and cursor-capped', () => {
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated;/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role;/)
    expect(sql).toContain("safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50)")
    expect(sql).toContain('LIMIT safe_limit + 1')
  })

  it('uses deterministic keyset ordering instead of offsets', () => {
    expect(sql).not.toMatch(/\bOFFSET\b/i)
    expect(sql).toContain('item.work_item_key > p_cursor_key')
    expect(sql).toContain('item.source_created_at < cursor_timestamp')
    expect(sql).toContain('lower(item.title) > p_cursor_value')
  })

  it('uses concrete server-owned sort plans and keeps user input parameterized', () => {
    expect(sql).toContain("page_order_sql := 'item.due_at ASC NULLS LAST, item.work_item_key ASC'")
    expect(sql).toContain("page_order_sql := 'item.source_created_at DESC, item.work_item_key ASC'")
    expect(sql).toContain('EXECUTE format($query$')
    expect(sql).toContain("LIKE '%%' || $7 || '%%'")
    expect(sql).toContain('USING clean_department, clean_view, clean_status')
  })

  it('discovers the installed trigram operator namespace', () => {
    expect(sql).toContain("extension.extname = 'pg_trgm'")
    expect(sql).toContain("%I.gin_trgm_ops")
    expect(sql).not.toContain('extensions.gin_trgm_ops')
  })
})
