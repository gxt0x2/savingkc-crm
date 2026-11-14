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
    requiresLicenseeDisclosure: true,
    prospectId: '00000000-0000-4000-8000-000000000010',
    phoneOrigin: 'prospect_phone',
    ...partial,
  })
}

describe('EXC-2026-11-14-003 expired owner override', () => {
  it('uses #814 phone block reasons for DNC, opt-out, voice hold, and property fan-out', () => {
    expect(gateSource).not.toMatch(/prospect_phone_dnc|person_fanout|household_fanout/)
    expect(migration).toContain('public.source_list_phone_block_reason_v1(dialed.phone_value, dialed.prospect_id)')
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

  it('blocks a Sunday list day and exports the calling window instead of the clock', () => {
    expect(gate({ listDay: '2026-11-15' })).toBe('outside_calling_hours')
    expect(gate({ listDay: '2026-11-14' })).toBeNull()
    expect(migration).toContain('mon_sat_0900_1900_america_chicago')
    expect(migration).toContain('EXTRACT(DOW FROM v_today) = 0')
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

  it('marks Kansas rows ks_license_unconfirmed', () => {
    expect(expiredRowStamp('KS').ksLicenseUnconfirmed).toBe(true)
    expect(expiredRowStamp('MO').ksLicenseUnconfirmed).toBe(false)
    expect(migration).toContain("upper(coalesce(dialed.state, '')) = 'KS'")
  })

  it('does not let the confirm switch skip an earlier condition', () => {
    expect(gate({ expiredOwnerConfirmed: true, lineChecksMerged: false })).toBe('line_check_unknown')
    expect(gate({ expiredOwnerConfirmed: false })).toBe('expired_owner_confirm_pending')
  })
})
