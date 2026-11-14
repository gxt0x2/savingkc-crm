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

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261215120000_property_market_checks.sql'),
  'utf8',
)
const gateSource = readFileSync(
  join(process.cwd(), 'src/lib/market-check/expired-gate.ts'),
  'utf8',
)

/** Saturday 14 Nov 2026, 10:00 America/Chicago (CST). */
const OPEN = new Date('2026-11-14T16:00:00Z')
/** Sunday 15 Nov 2026, 10:00 America/Chicago. */
const SUNDAY = new Date('2026-11-15T16:00:00Z')
/** Saturday 14 Nov 2026, 8:30pm America/Chicago, after 7:00pm. */
const LATE = new Date('2026-11-15T02:30:00Z')

function gate(partial: Partial<ExpiredRowGateInput> = {}): string | null {
  return expiredRowBlock({
    phoneBlockReason: null,
    lineChecksMerged: true,
    ownerChanged: false,
    latestStatus: 'listing_expired',
    hasRelistCheckToday: true,
    now: OPEN,
    channel: 'single_line_live_agent',
    expiredOwnerConfirmed: true,
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

  it('keeps the Monday-Saturday 9am-7pm Chicago calling window', () => {
    expect(gate({ now: SUNDAY })).toBe('outside_calling_hours')
    expect(gate({ now: LATE })).toBe('outside_calling_hours')
    expect(gate({ now: OPEN })).toBeNull()
    expect(migration).toContain("'outside_calling_hours'")
    expect(migration).toContain('America/Chicago')
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

  it('requires the licensee disclosure on every expired row', () => {
    expect(expiredRowStamp('MO').requiresLicenseeDisclosure).toBe(true)
    expect(expiredRowStamp('KS').requiresLicenseeDisclosure).toBe(true)
    expect(migration).toContain('requires_licensee_disclosure')
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
    expect(migration).toContain("dialed.state = 'KS'")
  })

  it('does not let the confirm switch skip an earlier condition', () => {
    expect(gate({ expiredOwnerConfirmed: true, lineChecksMerged: false })).toBe('line_check_unknown')
    expect(gate({ expiredOwnerConfirmed: false })).toBe('expired_owner_confirm_pending')
  })
})
