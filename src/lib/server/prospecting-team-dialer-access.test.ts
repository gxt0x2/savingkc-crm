import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const campaigns = readFileSync('src/lib/server/prospecting-campaigns.ts', 'utf8')
const activity = readFileSync('src/lib/server/prospecting-campaign-activity.ts', 'utf8')
const migration = readFileSync('supabase/migrations/20261024120000_team_operated_active_dialer_campaigns.sql', 'utf8')

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
})
