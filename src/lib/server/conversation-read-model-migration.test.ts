import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260819120000_conversation_read_model.sql'),
  'utf8',
)

describe('conversation read-model migration contract', () => {
  it('is additive, rebuildable, and explicitly contains its only projection delete', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.conversation_thread_state')
    expect(migration).toContain('hygiene-approved-destructive: remove only a rebuildable projection row')
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.lead_activities/i)
  })

  it('uses one activity keyset index and no offset scan', () => {
    expect(migration.match(/CREATE INDEX IF NOT EXISTS idx_conversation_activity_thread_/g)).toHaveLength(1)
    expect(migration).toContain('created_at DESC,\n    id DESC')
    expect(migration).not.toMatch(/\bOFFSET\b/i)
    expect(migration).toContain(
      'idx_conversation_thread_state_needs_reply\n  ON public.conversation_thread_state(attention_rank, last_activity_at DESC, thread_key DESC)',
    )
    expect(migration).toContain(
      'idx_sms_opt_outs_conversation_phone_active\n  ON public.sms_opt_outs(public.normalize_conversation_phone(phone))',
    )
    expect(migration).toContain(
      'idx_leads_conversation_phone\n  ON public.leads(public.normalize_conversation_phone(phone))',
    )
    expect(migration.match(/AND public\.conversation_is_timeline_activity\(activity\.activity_type, activity\.metadata\)/g))
      .toHaveLength(6)
    expect(migration.match(/WHERE public\.conversation_is_timeline_activity\(activity\.activity_type, activity\.metadata\)/g))
      .toHaveLength(1)
    expect(migration).toContain('rehearse and schedule it as a controlled apply')
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS extensions')
    expect(migration).toContain("WHERE extension.extname = 'pg_trgm'")
    expect(migration).toContain('search_text %I.gin_trgm_ops')
    expect(migration).not.toContain('search_text extensions.gin_trgm_ops')
  })

  it('caps both page RPCs and deterministically orders timeline ties', () => {
    expect(migration.match(/LIMIT LEAST\(GREATEST\(COALESCE\(page_limit, 51\), 1\), 101\)/g)).toHaveLength(2)
    expect(migration).toContain('ORDER BY activity.created_at DESC, activity.id DESC')
    expect(migration).toContain('activity.created_at = before_created_at AND activity.id < before_activity_id')
    expect(migration).toContain('thread.last_activity_at = after_activity_at')
    expect(migration).toContain('thread.thread_key < after_thread_key')
    expect(migration).toContain("'letter_tracking', 'task', 'status_change'")
  })

  it('treats missed calls and unmatched phone state as canonical thread inputs', () => {
    expect(migration).toContain("WHEN activity_kind IN ('missed_call', 'sms_received'")
    expect(migration).toContain("THEN 'phone:' || public.conversation_activity_phone")
    expect(migration).toContain("activity.metadata->>'hub_action' IN ('mark_read', 'mark_unread')")
    expect(migration).toContain("COALESCE(activity.metadata->>'status', 'pending') = 'pending'")
    expect(migration).toContain('target_thread_key,\n    latest_communication.lead_id')
    expect(migration).toContain("'spoke-with-owner', 'live'")
  })

  it('excludes internal alerts and queued placeholders from projection and timeline', () => {
    expect(migration).toContain("? 'to_agents'")
    expect(migration).toContain("? 'to_agent_phones'")
    expect(migration).toContain("? 'queue_contract'")
    expect(migration).toContain("activity_metadata->>'is_team'")
    expect(migration).toContain("activity_metadata->>'is_internal'")
    expect(migration).toContain("activity_metadata->>'internal_alert'")
    expect(migration).toContain("activity_metadata->>'outcome'")
    expect(migration).toContain("= 'agent_claimed'")
    expect(migration).toContain('conversation_is_legacy_team_alert')
    expect(migration).toContain('just texted:')
    expect(migration).toContain('open[[:space:]]+crm')
    expect(migration).toContain('public.conversation_is_customer_communication(activity.activity_type, activity.metadata)')
    expect(migration).toContain('public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)')
  })

  it('narrows write triggers and resolves active SMS opt-outs', () => {
    expect(migration).toContain('trigger_sync_conversation_thread_state_activity_insert')
    expect(migration).toContain('public.conversation_projects_thread(NEW.activity_type, NEW.metadata)')
    expect(migration).toContain(
      'AND NOT public.conversation_is_legacy_team_alert(NEW.activity_type, NEW.description, NEW.metadata)',
    )
    expect(migration).toContain('AFTER UPDATE OF full_name, phone, email, property_address, city, county, assigned_agent')
    expect(migration).not.toContain('trigger_sync_conversation_thread_state_lead\n  AFTER INSERT')
    expect(migration).toContain('trigger_sync_conversation_thread_state_sms_opt_out')
    expect(migration).toContain(
      'WHERE public.normalize_conversation_phone(opt_out.phone) = resolved_phone\n        AND opt_out.is_opted_out = TRUE',
    )
    expect(migration).toContain('PERFORM public.refresh_conversation_thread_state(target_thread_key);')
    expect(migration).toContain("SELECT 'phone:' || resolved_phone AS thread_key")
    expect(migration).toContain("SELECT 'lead:' || lead.id::TEXT AS thread_key")
    expect(migration).toContain('WHERE public.normalize_conversation_phone(lead.phone) = resolved_phone')
  })

  it('serializes runtime refreshes without retaining one lock per backfill thread', () => {
    const tableLockdown = migration.indexOf('ALTER TABLE public.conversation_thread_state ENABLE ROW LEVEL SECURITY;')
    const core = migration.indexOf('CREATE OR REPLACE FUNCTION public.refresh_conversation_thread_state_core(target_thread_key TEXT)')
    const coreRevoke = migration.indexOf('REVOKE ALL ON FUNCTION public.refresh_conversation_thread_state_core(TEXT)')
    const wrapper = migration.indexOf('CREATE OR REPLACE FUNCTION public.refresh_conversation_thread_state(target_thread_key TEXT)')
    const wrapperRevoke = migration.indexOf('REVOKE ALL ON FUNCTION public.refresh_conversation_thread_state(TEXT)', wrapper)
    const sharedGate = migration.indexOf('pg_catalog.pg_advisory_xact_lock_shared(', wrapper)
    const threadLock = migration.indexOf('pg_catalog.hashtextextended(target_thread_key, 0)', sharedGate)
    const coreCall = migration.indexOf('PERFORM public.refresh_conversation_thread_state_core(target_thread_key);', threadLock)
    const backfill = migration.indexOf('-- Exactly one exclusive gate is retained for this transaction')

    expect(tableLockdown).toBeGreaterThan(0)
    expect(core).toBeGreaterThan(tableLockdown)
    expect(coreRevoke).toBeGreaterThan(core)
    expect(wrapper).toBeGreaterThan(coreRevoke)
    expect(wrapperRevoke).toBeGreaterThan(wrapper)
    expect(backfill).toBeGreaterThan(wrapperRevoke)
    expect(sharedGate).toBeGreaterThan(wrapper)
    expect(threadLock).toBeGreaterThan(sharedGate)
    expect(coreCall).toBeGreaterThan(threadLock)
    expect(backfill).toBeGreaterThan(coreCall)
    expect(migration.indexOf("pg_catalog.hashtextextended('conversation_thread_state:backfill', 0)", backfill))
      .toBeGreaterThan(backfill)
    expect(migration.indexOf('PERFORM public.refresh_conversation_thread_state_core(thread.thread_key);', backfill))
      .toBeGreaterThan(backfill)
    expect(migration.slice(backfill)).not.toContain('PERFORM public.refresh_conversation_thread_state(thread.thread_key);')
    expect(migration).toContain('ORDER BY candidate.thread_key')
    expect(migration).toContain('PERFORM public.refresh_conversation_thread_state(target_thread_key);')
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.refresh_conversation_thread_state_core(TEXT)\n  FROM PUBLIC, anon, authenticated, service_role;',
    )
  })

  it('keeps read RPCs private to the service role', () => {
    for (const fn of [
      'conversation_thread_page_v1',
      'conversation_timeline_page_v1',
      'conversation_attention_summary_v1',
    ]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}`))
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[^;]* TO service_role`))
    }
  })
})
