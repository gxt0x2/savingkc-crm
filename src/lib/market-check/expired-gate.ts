/** Counsel exception EXC-2026-11-14-003. This is not the 8/29 clearance. */
export const EXPIRED_OWNER_OVERRIDE_BASIS = 'owner_override_2026-11-14'
export const AUGUST_29_CLEARED_BASIS = '2026-08-29-cleared'

/**
 * PR #812 has not merged. Expired rows fail closed until phone_line_checks exists
 * and source_list_phone_block_reason_v1 can return the line-check reason itself.
 */
export const PHONE_LINE_CHECKS_MERGED = false

export type ExpiredContactChannel = 'single_line_live_agent' | 'predictive' | 'multi_line' | 'sms'

export interface ExpiredRowStamp {
  basis: typeof EXPIRED_OWNER_OVERRIDE_BASIS
  requiresLicenseeDisclosure: true
  ksLicenseUnconfirmed: boolean
  countedAsAugust29Cleared: false
  contactChannel: 'single_line_live_agent'
  smsAllowed: false
  predictiveAllowed: false
  multiLineAllowed: false
  callingWindow: 'monday_saturday_0900_1900_america_chicago'
}

export function expiredRowStamp(state: string | null | undefined): ExpiredRowStamp {
  return {
    basis: EXPIRED_OWNER_OVERRIDE_BASIS,
    requiresLicenseeDisclosure: true,
    ksLicenseUnconfirmed: (state ?? '').toUpperCase() === 'KS',
    countedAsAugust29Cleared: false,
    contactChannel: 'single_line_live_agent',
    smsAllowed: false,
    predictiveAllowed: false,
    multiLineAllowed: false,
    callingWindow: 'monday_saturday_0900_1900_america_chicago',
  }
}

export function countsAsAugust29Cleared(basis: string): boolean {
  return basis === AUGUST_29_CLEARED_BASIS || basis === '8/29-cleared'
}

export interface ExpiredRowGateInput {
  /** Pass-through of source_list_phone_block_reason_v1. This module does not reclassify labels. */
  phoneBlockReason: string | null
  lineChecksMerged?: boolean
  ownerChanged: boolean
  ownerCheckUnknown?: boolean
  latestStatus: string | null
  hasRelistCheckToday: boolean
  listDay?: string | null
  channel: ExpiredContactChannel
  expiredOwnerConfirmed: boolean
}

/**
 * Every condition required before EXPIRED_OWNER_CONFIRMED can clear an expired row.
 * Internal DNC, opt-out, voice hold, and property fan-out arrive as phoneBlockReason
 * from source_list_phone_block_reason_v1 (#814). They are not reimplemented here.
 */
export function expiredRowBlock(input: ExpiredRowGateInput): string | null {
  if (!input.expiredOwnerConfirmed) return 'expired_owner_confirm_pending'
  if (input.phoneBlockReason) return input.phoneBlockReason
  if ((input.lineChecksMerged ?? PHONE_LINE_CHECKS_MERGED) !== true) return 'line_check_unknown'
  if (input.ownerCheckUnknown) return 'owner_check_unknown'
  if (input.ownerChanged) return 'owner_changed'
  if (!input.hasRelistCheckToday) return 'relist_check_missing'
  if (
    input.latestStatus === 'listed_active'
    || input.latestStatus === 'listed_pending'
    || input.latestStatus === 'sold_new_owner'
    || input.latestStatus === 'listed_withdrawn'
    || input.latestStatus === 'listing_check_unknown'
  ) {
    return input.latestStatus
  }
  if (input.latestStatus !== 'listing_expired' && input.latestStatus !== 'off_market_ok') {
    return 'relist_check_missing'
  }
  if (input.listDay && new Date(`${input.listDay}T00:00:00Z`).getUTCDay() === 0) return 'outside_calling_hours'
  if (input.channel !== 'single_line_live_agent') return 'single_line_live_agent_only'
  return null
}
