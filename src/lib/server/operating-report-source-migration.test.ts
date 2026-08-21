import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260903120000_operating_report_period_indexes.sql', 'utf8')

describe('operating report period indexes', () => {
  it('indexes each newly period-filtered source path', () => {
    expect(migration).toContain('idx_leads_operating_report_created')
    expect(migration).toContain('idx_lead_activities_operating_report_created')
    expect(migration).toContain('idx_dispo_deals_operating_report_entered')
    expect(migration).toContain('idx_dispo_deals_operating_report_closed')
    expect(migration).toContain('idx_buyer_offers_operating_report_submitted')
    expect(migration).toContain('idx_buyer_offers_operating_report_created')
    expect(migration).toContain('idx_buyers_operating_report_created')
  })
})
