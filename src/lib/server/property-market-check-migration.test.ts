import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRICE_THRESHOLDS, TARGET_ZIPS } from '@/lib/market-check/seeds'

const migration = [
  'supabase/migrations/20261215120000_property_market_checks.sql',
  'supabase/migrations/20261215130000_market_check_fix_round.sql',
].map((file) => readFileSync(join(process.cwd(), file), 'utf8')).join('\n')

describe('property market check migration', () => {
  it('follows the suppression classifier and keeps the phone scrub', () => {
    expect(migration).toContain('public.source_list_phone_block_reason_v1(dialed.phone_value, dialed.prospect_id)')
    expect(migration).toContain('public.source_list_market_block_reason_v1')
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.dialer_suppression_class_v1')
    expect(migration).not.toMatch(/\bmojo_call_queue\b/)
    expect(migration).not.toContain('dnc_registry_scrubs')
    expect(migration).not.toContain('expired_lane_registry_pending')
  })

  it('seeds the rollout flags, Jackson zips, and price floors', () => {
    expect(migration).toContain("('MLS_MARKET_CHECK_ENABLED', 'false')")
    expect(migration).toContain("('EXPIRED_OWNER_CONFIRMED', 'false')")
    expect(migration).toContain("('MLS_EXPIRED_WINDOW_DAYS', '90')")
    for (const zip of TARGET_ZIPS) {
      expect(migration).toContain(`('${zip.zip5}', 'jackson', 'MO', '${zip.status}')`)
    }
    for (const price of PRICE_THRESHOLDS) {
      expect(migration).toContain(`('${price.zip5}', ${price.minListPrice}, '${price.method}')`)
    }
    expect(migration).toContain("'parked'")
    expect(migration).toContain("'avoid'")
  })

  it('seeds listed and sold CRM leads as blocking checks', () => {
    expect(migration).toContain("'crm_lead'")
    expect(migration).toContain("'listed_active'")
    expect(migration).toContain("'sold_new_owner'")
    expect(migration).toContain("'listed_agent'")
    expect(migration).toContain("'sold_or_competitor'")
  })

  it('adds the export labels, disclosure columns, and the high-price review', () => {
    expect(migration).toContain("'expired_owner_confirm_pending'")
    expect(migration).toContain("'active_high_price'")
    expect(migration).toContain("'owner_changed'")
    expect(migration).toContain("'relist_check_missing'")
    expect(migration).toContain('requires_licensee_disclosure')
    expect(migration).toContain('ks_license_unconfirmed')
    expect(migration).toContain('AS basis')
    expect(migration).toContain("'owner_override_2026-11-14'")
    expect(migration).toContain("'line_check_unknown'")
    expect(migration).toContain("'outside_calling_hours'")
    expect(migration).toContain("v_status IN ('listed_active', 'listed_pending')")
    expect(migration).toContain("to_regclass('public.phone_line_checks') IS NULL")
    expect(migration).toContain('CREATE OR REPLACE VIEW public.review_high_price')
    expect(migration).toContain('CREATE OR REPLACE VIEW public.property_market_status_v1')
    expect(migration).toContain('parcel_inventory')
    expect(migration).toContain('prospect.owner_1')
    expect(migration).toContain('inventory.owner_name')
    expect(migration).toContain('property_market_checks is append-only')
    expect(migration).toContain('whole metro')
  })
})
