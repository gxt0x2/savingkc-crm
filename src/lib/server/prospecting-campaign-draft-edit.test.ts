import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260904124500_prospecting_campaign_draft_edit.sql'), 'utf8')

describe('prospecting campaign draft edit migration', () => {
  it('serializes an owner-owned draft and rejects live or previously run campaigns', () => {
    expect(migration).toContain("lower(owner_email) = lower(trim(p_actor_email))")
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain("campaign_row.status <> 'draft'")
    expect(migration).toContain('public.prospecting_campaign_actions WHERE campaign_id = p_campaign_id')
  })

  it('replaces only draft setup and preserves the campaign audience', () => {
    expect(migration).toContain('UPDATE public.prospecting_campaigns')
    expect(migration).toContain('DELETE FROM public.prospecting_campaign_steps')
    expect(migration).not.toContain('DELETE FROM public.prospecting_campaign_members')
    expect(migration).toContain("'campaign_setup_updated'")
  })

  it('is service-role only', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
  })
})
