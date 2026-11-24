import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261201120000_default_acquisitions_owner.sql'),
  'utf8',
)

describe('default acquisitions owner', () => {
  it('keeps one database setting and fills only a blank owner', () => {
    expect(migration).toContain("'default_acquisitions_owner'")
    expect(migration).toContain("'displayName', 'Casey'")
    expect(migration).toContain("lower(profile.email) = 'casey@savingkc.com'")
    expect(migration).toContain('ON CONFLICT (key) DO NOTHING')
    expect(migration).toContain('CREATE TRIGGER trigger_assign_default_acquisitions_owner')
    expect(migration).toContain('BEFORE INSERT ON public.leads')
    expect(migration).toContain("NULLIF(btrim(NEW.assigned_agent), '') IS NOT NULL")
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.default_acquisitions_owner_name() TO service_role')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).not.toMatch(/mojo_call_queue/)
    expect(migration).not.toMatch(/CRON_SECRET/)
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
  })

  it('backfills open files once and leaves dead, closed, activities, and other columns alone', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.backfill_default_acquisitions_owner_v1()')
    expect(migration).toContain("lower(COALESCE(lead_classification, '')) = 'dead'")
    expect(migration).toContain("'closed_lost', 'closed_won'")
    expect(migration).toContain('SET assigned_agent = owner_label')
    expect(migration).toContain('SET owner_name = owner_label')
    expect(migration).toContain('SET owner = owner_label')
    expect(migration).toContain('default_acquisitions_owner_backfill_receipt')
    expect(migration).toContain("'replayed', true")
    expect(migration).toContain('trigger_queue_briefing_from_lead')
    expect(migration).toContain('trigger_queue_briefing_from_opportunity')
    expect(migration).toContain('set_default_owner_backfill_triggers_v1(false)')
    expect(migration).toContain('set_default_owner_backfill_triggers_v1(true)')
    expect(migration).not.toMatch(/lead_activities/)
    expect(migration).not.toMatch(/primary_next_action_owner/)
    expect(migration).not.toMatch(/SET\s+updated_at/i)
  })

  it('rehearses assignment and the one-time backfill on PostgreSQL', () => {
    const output = execFileSync('bash', ['scripts/rehearse-default-acquisitions-owner.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(output).toContain('rehearsal_ok')
  }, 120_000)
})
