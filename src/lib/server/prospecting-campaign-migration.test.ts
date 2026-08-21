import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260904120000_prospecting_campaigns.sql'), 'utf8')

describe('prospecting campaign migration contract', () => {
  it('keeps campaign state and execution server-only', () => {
    expect(migration).toContain('ALTER TABLE public.prospecting_campaigns ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.create_prospecting_campaign_v1')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.claim_prospecting_campaign_action_v1')
  })

  it('claims due work with a lease and skip-locked row boundary', () => {
    expect(migration).toContain('FOR UPDATE OF action SKIP LOCKED')
    expect(migration).toContain("action.status = 'processing' AND action.lease_expires_at < now()")
    expect(migration).toContain('p_lease_seconds NOT BETWEEN 30 AND 600')
  })

  it('serializes pacing reservations and counts delivery evidence fail closed', () => {
    expect(migration).toContain("hashtextextended('prospecting-sms-budget', 0)")
    expect(migration).toContain('FROM public.sms_delivery_log log')
    expect(migration).toContain("status IN ('reserved', 'consumed')")
    expect(migration).toContain("RETURN jsonb_build_object('reserved', false")
    expect(migration).toContain("AND campaign.status = 'active'")
    expect(migration).toContain("AND member.status = 'active'")
  })

  it('indexes normalized opt-outs and active campaign phone membership', () => {
    expect(migration).toContain('idx_sms_opt_outs_prospecting_phone_active')
    expect(migration).toContain('idx_prospecting_campaign_members_phone_active')
  })

  it('stops remaining sequence steps on replies and opt-outs', () => {
    expect(migration).toContain('prospecting_stop_on_sms_reply')
    expect(migration).toContain("SET status = 'replied'")
    expect(migration).toContain('prospecting_suppress_on_sms_opt_out')
    expect(migration).toContain("SET status = 'suppressed'")
  })

  it('links the existing single-line session engine instead of creating a second dialer', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS prospecting_campaign_id')
    expect(migration).not.toContain('lines_per_agent integer')
  })
})
