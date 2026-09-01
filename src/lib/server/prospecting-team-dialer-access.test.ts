import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const campaigns = readFileSync('src/lib/server/prospecting-campaigns.ts', 'utf8')
const activity = readFileSync('src/lib/server/prospecting-campaign-activity.ts', 'utf8')
const migration = readFileSync('supabase/migrations/20261024123000_team_operated_active_dialer_campaigns.sql', 'utf8')
const repairMigration = readFileSync('supabase/migrations/20261027120000_repair_team_operated_active_dialer_access.sql', 'utf8')

describe('team-operated active prospecting dialer campaigns', () => {
  it('shares only active dialer campaigns while preserving owner-only administration', () => {
    expect(campaigns).toContain('and(kind.eq.dialer,status.eq.active)')
    expect(campaigns).toContain("campaignRow.kind === 'dialer' && campaignRow.status === 'active'")
    expect(campaigns).toContain("campaign.ownerEmail.trim().toLowerCase() !== actor.email.trim().toLowerCase()")
    expect(activity).toContain("campaign?.kind === 'dialer' && campaign.status === 'active'")
  })

  it('allows an authenticated team operator to create a session under their own identity', () => {
    expect(migration).toContain("kind = ''dialer'' AND status = ''active''")
    expect(migration).toContain('refusing unsafe patch')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4')
  })

  it('repairs both launch and audience access after an out-of-order production migration', () => {
    expect(repairMigration).toContain('start_prospecting_dialer_session_v4_missing')
    expect(repairMigration).toContain("kind = ''dialer'' AND status = ''active''")
    expect(repairMigration).toContain('prospecting_campaign_member_page_v3_missing')
    expect(repairMigration).toContain("campaign.kind = ''dialer'' AND campaign.status = ''active''")
    expect(repairMigration).toContain('prospecting_campaign_member_page_v3_team_guard_patch_failed')
    expect(repairMigration).toContain('REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4')
    expect(repairMigration).toContain('REVOKE ALL ON FUNCTION public.prospecting_campaign_member_page_v3')
    expect(repairMigration).toContain('TO service_role')
  })
})
