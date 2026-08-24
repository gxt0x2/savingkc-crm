import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/lib/server/prospecting-campaign-activity.ts'), 'utf8')
const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260904150000_prospecting_campaign_activity_filters.sql'), 'utf8')

describe('prospecting campaign activity data plane', () => {
  it('checks campaign ownership before reading protected history', () => {
    expect(source.indexOf(".eq('owner_email', actor.email.toLowerCase())")).toBeGreaterThan(-1)
    expect(source.indexOf(".eq('owner_email', actor.email.toLowerCase())")).toBeLessThan(source.indexOf(".from('prospecting_campaign_events')"))
  })

  it('uses indexed keyset ordering and caps every hydration set', () => {
    expect(source).toContain(".order('created_at', { ascending: false })")
    expect(source).toContain(".order('id', { ascending: false })")
    expect(source).toContain('.limit(limit + 1)')
    expect(source).toContain("created_at.lt.${cursor.createdAt}")
    expect(source.match(/\.limit\(50\)/g)).toHaveLength(2)
  })

  it('filters operational views on the server and indexes event type history', () => {
    expect(source).toContain("replies: ['campaign_member_replied', 'campaign_member_suppressed']")
    expect(source).toContain("failures: ['campaign_action_failed', 'campaign_action_blocked']")
    expect(source).toContain("eventQuery.in('event_type'")
    expect(source).toContain("new ProspectingCampaignError('invalid_activity_filter', 400")
    expect(migration).toContain('(campaign_id, event_type, created_at DESC, id DESC)')
  })

  it('hydrates source Prospect provenance and returns the canonical phone inbox key', () => {
    expect(source).toContain('prospects(owner_1,situs_street,situs_city,situs_state,situs_zip)')
    expect(source).toContain("member?.subject_kind === 'prospect'")
    expect(source).toContain('conversationThreadId: leadId || (normalizedPhone ? `phone:${normalizedPhone}` : null)')
    expect(source).toContain("'campaign_sms_recipient_reviewed'")
  })
})
