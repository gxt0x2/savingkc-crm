import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260904143000_prospecting_reply_handoff.sql'), 'utf8')
const activity = readFileSync(join(process.cwd(), 'src/lib/server/prospecting-campaign-activity.ts'), 'utf8')

describe('prospecting reply handoff', () => {
  it('attributes a first seller reply after an active or completed cadence and cancels remaining work', () => {
    expect(migration).toContain("member.status IN ('active', 'completed')")
    expect(migration).toContain("campaign.status IN ('active', 'paused', 'completed')")
    expect(migration).toContain("'campaign_member_replied'")
    expect(migration).toContain("status = 'cancelled', completed_at = now(), error_code = 'contact_replied'")
  })

  it('lets a durable opt-out override completed or replied campaign state', () => {
    expect(migration).toContain("member.status IN ('active', 'completed', 'replied')")
    expect(migration).toContain("'campaign_member_suppressed'")
    expect(migration).toContain("error_code = 'sms_opt_out'")
  })

  it('keeps trigger execution private and returns reply provenance through the bounded activity feed', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
    expect(activity).toContain("select('id,subject_kind,lead_id,prospect_id,phone_snapshot,leads(full_name,property_address),prospects(owner_1,situs_street,situs_city,situs_state,situs_zip)')")
    expect(activity).toContain('conversationThreadId: leadId || (normalizedPhone ? `phone:${normalizedPhone}` : null)')
    expect(activity).toContain('body: text(metadata.message) || text(action?.rendered_body)')
  })
})
