import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUGUST_29_CLEARED_BASIS,
  countsAsAugust29Cleared,
  EXPIRED_OWNER_OVERRIDE_BASIS,
  expiredRowBlock,
  expiredRowStamp,
  PHONE_LINE_CHECKS_MERGED,
  type ExpiredRowGateInput,
} from '@/lib/market-check/expired-gate'
import { classifyMatrixStatus } from '@/lib/market-check/plan'

const OPEN = new Date('2026-11-14T16:00:00Z')

const migration = [
  'supabase/migrations/20261215120000_property_market_checks.sql',
  'supabase/migrations/20261215130000_market_check_fix_round.sql',
].map((file) => readFileSync(join(process.cwd(), file), 'utf8')).join('\n')
const gateSource = readFileSync(
  join(process.cwd(), 'src/lib/market-check/expired-gate.ts'),
  'utf8',
)

function gate(partial: Partial<ExpiredRowGateInput> = {}): string | null {
  return expiredRowBlock({
    phoneBlockReason: null,
    lineChecksMerged: true,
    ownerChanged: false,
    latestStatus: 'listing_expired',
    hasRelistCheckToday: true,
    listDay: '2026-11-14',
    channel: 'single_line_live_agent',
    expiredOwnerConfirmed: true,
    now: OPEN,
    state: 'MO',
    county: 'jackson',
    requiresLicenseeDisclosure: true,
    prospectId: '00000000-0000-4000-8000-000000000010',
    phoneOrigin: 'prospect_phone',
    ...partial,
  })
}

describe('EXC-2026-11-14-003 expired owner override', () => {
  it('uses #814 phone block reasons for DNC, opt-out, voice hold, and property fan-out', () => {
    expect(gateSource).not.toMatch(/prospect_phone_dnc|person_fanout|household_fanout/)
    expect(migration).toContain('public.source_list_phone_block_reasons_v1')
    expect(migration).toContain('dialed.block_reason')
    expect(migration).not.toContain('prospect_phone_dnc')
    for (const reason of ['prospect_dnc', 'lead_dnc', 'sms_opt_out', 'contact_opt_out', 'voice_hold', 'person_fanout', 'household_fanout']) {
      expect(gate({ phoneBlockReason: reason })).toBe(reason)
    }
  })

  it('fails closed as line_check_unknown until the line check in #812 is merged', () => {
    expect(PHONE_LINE_CHECKS_MERGED).toBe(false)
    expect(gate({ lineChecksMerged: false })).toBe('line_check_unknown')
    expect(migration).toContain("to_regclass('public.phone_line_checks') IS NULL")
    expect(migration).toContain("'line_check_unknown'")
  })

  it('blocks owner_changed before the confirm switch can clear the row', () => {
    expect(gate({ ownerChanged: true })).toBe('owner_changed')
  })

  it('blocks a same-day Active, Coming Soon, or Pending relist', () => {
    expect(classifyMatrixStatus('ACTIVE', { closeDate: null, expireDate: null }, '2026-11-14', 90)).toBe('listed_active')
    expect(classifyMatrixStatus('COMING SOON', { closeDate: null, expireDate: null }, '2026-11-14', 90)).toBe('listed_active')
    expect(classifyMatrixStatus('PENDING', { closeDate: null, expireDate: null }, '2026-11-14', 90)).toBe('listed_pending')
    expect(gate({ hasRelistCheckToday: false })).toBe('relist_check_missing')
    expect(gate({ latestStatus: 'listed_active' })).toBe('listed_active')
    expect(gate({ latestStatus: 'listed_pending' })).toBe('listed_pending')
    expect(migration).toContain("v_status IN ('listed_active', 'listed_pending')")
  })

  it('enforces Monday-Saturday 09:00-17:00 America/Chicago at the clock', () => {
    expect(gate({ now: OPEN })).toBeNull()
    expect(gate({ now: new Date('2026-11-14T23:30:00Z') })).toBe('outside_calling_hours')
    expect(gate({ now: new Date('2026-11-15T16:00:00Z') })).toBe('outside_calling_hours')
    expect(gate({ now: new Date('2026-11-16T14:59:00Z') })).toBe('outside_calling_hours')
    expect(gate({ now: new Date('2026-11-16T15:00:00Z') })).toBeNull()
    expect(gate({ now: undefined })).toBe('outside_calling_hours')
    expect(migration).toContain('market_calling_window_open_v1')
    expect(migration).not.toContain('EXTRACT(DOW FROM v_today) = 0')
    expect(migration).toContain('mon_sat_0900_1700_america_chicago')
  })

  it('allows only a single live-agent line', () => {
    expect(gate({ channel: 'predictive' })).toBe('single_line_live_agent_only')
    expect(gate({ channel: 'multi_line' })).toBe('single_line_live_agent_only')
    expect(gate({ channel: 'sms' })).toBe('single_line_live_agent_only')
    expect(gate({ channel: 'single_line_live_agent' })).toBeNull()
    expect(expiredRowStamp('MO').contactChannel).toBe('single_line_live_agent')
    expect(expiredRowStamp('MO').smsAllowed).toBe(false)
    expect(expiredRowStamp('MO').predictiveAllowed).toBe(false)
    expect(expiredRowStamp('MO').multiLineAllowed).toBe(false)
  })

  it('requires the licensee disclosure on the export path, not only as a stamp', () => {
    expect(expiredRowStamp('MO').requiresLicenseeDisclosure).toBe(true)
    expect(expiredRowStamp('KS').requiresLicenseeDisclosure).toBe(true)
    expect(gate({ requiresLicenseeDisclosure: false })).toBe('licensee_disclosure_required')
    expect(gate({ requiresLicenseeDisclosure: undefined })).toBe('licensee_disclosure_required')
    expect(migration).toContain("RAISE EXCEPTION 'licensee_disclosure_required'")
    expect(migration).toContain("RAISE EXCEPTION 'expired_single_line_only'")
    expect(migration).toContain('requires_licensee_disclosure IS TRUE')
    expect(migration).toContain("phone_origin = 'prospect_phone'")
  })

  it('blocks a skip-traced expired phone that has no linked prospect', () => {
    expect(gate({ prospectId: null, phoneOrigin: 'source_row' })).toBe('owner_match_missing')
    expect(gate({ prospectId: null, phoneOrigin: 'prospect_phone' })).toBe('owner_match_missing')
    expect(gate({ prospectId: '00000000-0000-4000-8000-000000000010', phoneOrigin: 'source_row' })).toBe('owner_match_missing')
    expect(migration).toContain("RETURN 'owner_match_missing'")
  })

  it('stamps the owner-override basis and never treats it as 8/29-cleared', () => {
    const stamp = expiredRowStamp('MO')
    expect(stamp.basis).toBe(EXPIRED_OWNER_OVERRIDE_BASIS)
    expect(stamp.countedAsAugust29Cleared).toBe(false)
    expect(countsAsAugust29Cleared(stamp.basis)).toBe(false)
    expect(countsAsAugust29Cleared(AUGUST_29_CLEARED_BASIS)).toBe(true)
    expect(migration).toContain("'owner_override_2026-11-14'")
  })

  it('refuses a Kansas expired row and leaves a Missouri expired row alone', () => {
    expect(expiredRowStamp('KS').ksLicenseUnconfirmed).toBe(true)
    expect(expiredRowStamp('MO').ksLicenseUnconfirmed).toBe(false)
    expect(gate({ state: 'KS', county: 'johnson' })).toBe('ks_license_unconfirmed')
    expect(gate({ state: 'KS', county: 'wyandotte', ksExpiredReleaseApproved: false })).toBe('ks_license_unconfirmed')
    expect(gate({ state: 'MO', county: 'jackson' })).toBeNull()
    expect(gate({ state: 'MO', county: 'clay' })).toBeNull()
    expect(gate({ state: 'MO', county: 'platte' })).toBeNull()
    expect(gate({ state: 'KS', county: 'johnson', ksExpiredReleaseApproved: true })).toBeNull()
    expect(migration).toContain("('KS_EXPIRED_RELEASE_APPROVED', 'false')")
    expect(migration).toContain("RETURN 'ks_license_unconfirmed'")
    expect(migration).toContain("upper(coalesce(review.state, '')) = 'KS'")
    expect(migration).not.toContain("KS_EXPIRED_RELEASE_APPROVED', 'true'")
  })

  it('does not let the confirm switch skip an earlier condition', () => {
    expect(gate({ expiredOwnerConfirmed: true, lineChecksMerged: false })).toBe('line_check_unknown')
    expect(gate({ expiredOwnerConfirmed: false })).toBe('expired_owner_confirm_pending')
  })
})
