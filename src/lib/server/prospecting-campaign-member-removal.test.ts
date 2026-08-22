import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260904123000_prospecting_campaign_member_removal.sql'), 'utf8')

describe('prospecting campaign member removal migration', () => {
  it('keeps removal owner-scoped, history-preserving, and unavailable while a campaign is live', () => {
    expect(migration).toContain('idx_prospecting_campaign_members_current_audience')
    expect(migration).toContain("lower(owner_email) = lower(trim(p_actor_email))")
    expect(migration).toContain("campaign_row.status NOT IN ('draft', 'paused')")
    expect(migration).toContain("SET status = 'removed'")
    expect(migration).toContain('UPDATE public.prospecting_campaigns')
    expect(migration).not.toContain('DELETE FROM public.prospecting_campaign_members')
  })

  it('cancels unsent work, releases reserved capacity, and records an audit event', () => {
    expect(migration).toContain("action.status IN ('queued', 'processing')")
    expect(migration).toContain("SET status = 'released'")
    expect(migration).toContain("'member_removed'")
    expect(migration).toContain("'cancelled_actions'")
  })

  it('exposes the mutation only to the server service role', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
  })
})
