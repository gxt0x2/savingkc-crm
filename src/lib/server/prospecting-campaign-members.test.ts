import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/lib/server/prospecting-campaign-members.ts'), 'utf8')
const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260904134500_prospecting_campaign_audience_search.sql'), 'utf8')

describe('prospecting campaign audience data plane', () => {
  it('delegates ownership and search to one service-only database boundary', () => {
    expect(source).toContain("rpc('prospecting_campaign_member_page_v2'")
    expect(migration).toContain('lower(campaign.owner_email) = clean_actor')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.prospecting_campaign_member_page_v2')
    expect(migration).toContain('TO service_role')
  })

  it('uses a maintained trigram projection and a capped keyset page', () => {
    expect(migration).toContain('idx_prospecting_campaign_members_search')
    expect(migration).toContain("member.search_text LIKE '%' || search_pattern || '%' ESCAPE E'\\\\'")
    expect(migration).toContain('ORDER BY member.enrolled_at DESC, member.id DESC')
    expect(migration).toContain('LIMIT safe_limit + 1')
    expect(source).toContain('p_after_enrolled_at: cursor?.enrolledAt || null')
  })

  it('refreshes indexed search text when either the member or lead identity changes', () => {
    expect(migration).toContain('set_prospecting_campaign_member_search_v1')
    expect(migration).toContain('refresh_prospecting_campaign_member_search_from_lead_v1')
    expect(migration).toContain('AFTER UPDATE OF full_name, property_address, phone')
  })
})
