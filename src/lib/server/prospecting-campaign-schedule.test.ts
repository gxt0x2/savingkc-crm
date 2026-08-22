import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260904133000_prospecting_campaign_schedule.sql'), 'utf8')
const server = readFileSync(join(process.cwd(), 'src/lib/server/prospecting-campaigns.ts'), 'utf8')

describe('prospecting campaign schedule migration', () => {
  it('adds zero-downtime V2 create and edit boundaries', () => {
    expect(migration).toContain('public.create_prospecting_campaign_v2')
    expect(migration).toContain('public.update_prospecting_campaign_draft_v2')
    expect(migration).toContain('public.create_prospecting_campaign_v1(')
    expect(migration).toContain('public.update_prospecting_campaign_draft_v1(')
    expect(server).toContain("rpc('create_prospecting_campaign_v2'")
    expect(server).toContain("rpc('update_prospecting_campaign_draft_v2'")
    expect(server).toContain('p_send_window_start: input.sendWindowStart')
    expect(server).toContain('p_send_days: input.sendDays')
  })

  it('validates a non-empty unique weekday set and ordered local times', () => {
    expect(migration).toContain('p_send_window_start >= p_send_window_end')
    expect(migration).toContain('cardinality(p_send_days) NOT BETWEEN 1 AND 7')
    expect(migration).toContain('count(DISTINCT day)')
  })

  it('keeps all new functions service-role only', () => {
    expect(migration.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(3)
    expect(migration.match(/TO service_role/g)).toHaveLength(3)
  })
})
