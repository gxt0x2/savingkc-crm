import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261002130000_mobile_message_inbox_projection.sql'), 'utf8')
const pageFunction = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.conversation_message_thread_page_v1'))

describe('mobile message inbox projection migration', () => {
  it('maintains a separate latest-message projection with indexed keyset paging', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.mobile_message_thread_state')
    expect(migration).toContain('CREATE TRIGGER trigger_sync_mobile_message_thread_state_activity')
    expect(migration).toContain('CREATE TRIGGER trigger_sync_mobile_message_thread_state_lead')
    expect(migration).toContain('idx_mobile_message_thread_inbox')
    expect(migration).toContain('conversation_activity_thread_key')
    expect(migration).toContain('email_received')
    expect(pageFunction).toContain('RETURNS SETOF public.mobile_message_thread_state')
    expect(pageFunction).toContain('thread.last_activity_at < after_activity_at')
    expect(pageFunction).toContain('thread.thread_key < after_thread_key')
    expect(pageFunction).toContain('LIMIT least(greatest(coalesce(page_limit, 51), 1), 101)')
    expect(pageFunction).not.toContain('FROM public.lead_activities')
  })

  it('keeps read and refresh permissions server-owned', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.conversation_message_thread_page_v1[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.conversation_message_thread_page_v1[^;]*TO service_role/)
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.mobile_message_thread_state FROM PUBLIC, anon, authenticated/)
  })
})
