import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260824120000_contact_workspace_activity_summary.sql',
  'utf8',
)

describe('contact workspace activity summary migration', () => {
  it('caps requests and returns one compact row per requested lead', () => {
    expect(migration).toContain("COALESCE(cardinality(target_lead_ids), 0) > 1000")
    expect(migration).toContain('SELECT DISTINCT requested_id AS lead_id')
    expect(migration).toContain('LEFT JOIN public.conversation_thread_state AS thread')
    expect(migration).toContain('LEFT JOIN public.contact_workspace_activity_state AS activity_state')
    expect(migration).not.toMatch(/SELECT\s+activity\.\*/i)
  })

  it('maintains an incremental projection with indexed source probes', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.contact_workspace_activity_state')
    expect(migration).toContain('idx_conversation_thread_state_lead')
    expect(migration).toContain('public.conversation_activity_thread_key(')
    expect(migration).toContain('public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)')
    expect(migration).toContain('public.conversation_is_customer_communication(activity.activity_type, activity.metadata)')
    expect(migration).toContain('trigger_refresh_contact_workspace_activity_state')
    expect(migration).toContain("hashtextextended('contact_workspace_activity_state:backfill', 0)")
    expect(migration).toContain('PERFORM public.refresh_contact_workspace_activity_state_core(lead.id);')
  })

  it('keeps the RPC service-role only', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.contact_workspace_activity_summary_v1(UUID[])\n  FROM PUBLIC, anon, authenticated;',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.contact_workspace_activity_summary_v1(UUID[])\n  TO service_role;',
    )
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.refresh_contact_workspace_activity_state_core(UUID)\n  FROM PUBLIC, anon, authenticated, service_role;',
    )
  })
})
