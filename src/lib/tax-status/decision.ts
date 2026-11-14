import type { LiveTaxBalance } from './balances'

/** Service area. Cass is excluded. Out-of-area parcels are not sent to a county source. */
export const SERVICE_COUNTIES = ['jackson', 'clay', 'platte', 'johnson', 'wyandotte'] as const
export type ServiceCounty = (typeof SERVICE_COUNTIES)[number]

export const DELINQUENT_BALANCE_FLOOR = 500
export const FRESH_CHECK_MS = 7 * 24 * 60 * 60 * 1000

export const LIVE_BALANCE_SOURCES = [
  'jackson_tax_portal',
  'johnson_taxbill',
  'clay_collector',
  'platte_collector',
  'wyandotte_tax',
] as const
export type LiveBalanceSource = (typeof LIVE_BALANCE_SOURCES)[number]

export type TaxTier = '2yr' | '3yr_plus'
export type TaxCheckResult = 'delinquent' | 'not_delinquent' | 'not_verified'

const TAX_LIST_TYPES = new Set([
  'tax',
  'tax_delinquent',
  'tax_2yr',
  'tax_3_plus',
  'tax_3yr_plus',
])

export function canonicalCounty(value: string | null | undefined): string | null {
  const token = (value ?? '')
    .toLowerCase()
    .replace(/county/g, '')
    .replace(/[^a-z]/g, '')
  return token || null
}

export function serviceCounty(value: string | null | undefined): ServiceCounty | null {
  const county = canonicalCounty(value)
  return (SERVICE_COUNTIES as readonly string[]).includes(county ?? '')
    ? county as ServiceCounty
    : null
}

/** Tax-sourced lists suppress paid-up parcels. Every other list, including future ones, does not. */
export function isTaxSourcedList(listType: string | null | undefined, prospectTrack?: string | null): boolean {
  const token = (listType ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (TAX_LIST_TYPES.has(token)) return true
  return prospectTrack === 'tax' && (token === 'county_audience' || token === 'prospect')
}

/**
 * Still delinquent only from the latest live balance:
 * at least one prior tax year unpaid AND balance >= $500.
 * Paid to zero, under $500, or redeemed is not delinquent.
 * `historicalTag` is accepted so callers can pass the list tag and tests can
 * prove it does not decide the result.
 */
export function judgeLiveBalance(
  input: {
    balance: LiveTaxBalance | null
    sourceDown: boolean
    historicalTag?: string | null
  },
): TaxCheckResult {
  void input.historicalTag
  if (input.sourceDown || !input.balance) return 'not_verified'
  const { balance, yearsOwed, redeemed } = input.balance
  if (!Number.isFinite(balance) || !Number.isFinite(yearsOwed)) return 'not_verified'
  if (redeemed || balance <= 0 || balance < DELINQUENT_BALANCE_FLOOR || yearsOwed < 1) {
    return 'not_delinquent'
  }
  return 'delinquent'
}

/**
 * Named tiers stay 3+ years and 2 years. A parcel that is still delinquent
 * but falls below its tier moves down. It is not removed from the pipeline.
 * One prior year still delinquent is held on the 2-year tier, the lowest one.
 */
export function nextTaxTier(
  current: TaxTier | null,
  yearsOwed: number,
  delinquent: boolean,
): TaxTier | null {
  void current
  if (!delinquent) return null
  if (yearsOwed >= 3) return '3yr_plus'
  return '2yr'
}

export function isFreshDelinquentCheck(
  check: { result: TaxCheckResult; checkedAt: string; source: string } | null,
  now: Date,
): boolean {
  if (!check || check.result !== 'delinquent') return false
  if (!(LIVE_BALANCE_SOURCES as readonly string[]).includes(check.source)) return false
  const checked = Date.parse(check.checkedAt)
  if (!Number.isFinite(checked)) return false
  return now.getTime() - checked <= FRESH_CHECK_MS && checked <= now.getTime() + 60_000
}

/** Hard pre-export rule for tax-sourced prospects. A list tag is not a check. */
export function taxExportAllowed(
  check: { result: TaxCheckResult; checkedAt: string; source: string } | null,
  now: Date,
): boolean {
  return isFreshDelinquentCheck(check, now)
}
