import type { ListingStatus } from '@/lib/market-check/plan'

export const NINETY_PLUS_DAYS = 90
export const NINETY_PLUS_BASIS = 'owner_ruling_2026-11-17_listing_agent'

const NINETY_PLUS_STATUSES = new Set<ListingStatus>(['listed_active', 'listed_withdrawn'])

export interface NinetyPlusCandidate {
  propertyKey?: string
  listingStatus: ListingStatus | string
  dom: number | null
  cdom: number | null
  checkedOn: string | null
  listingAgentName?: string | null
  listingAgentPhone?: string | null
  listingOffice?: string | null
}

export interface NinetyPlusRow<T> {
  row: T
  requiresLicenseeDisclosure: true
  basis: typeof NINETY_PLUS_BASIS
}

/**
 * Latest check per property, then active or withdrawn rows checked on runDate
 * with DOM or CDOM of 90 or more. A later unmapped or pending row replaces an
 * older active row and stays out. The offer goes through the listing agent.
 */
export function selectNinetyPlusDays<T extends NinetyPlusCandidate>(
  rows: readonly T[],
  runDate: string,
): Array<NinetyPlusRow<T>> {
  const latest = new Map<string, T>()
  rows.forEach((row, index) => {
    const key = row.propertyKey || `row:${index}`
    const current = latest.get(key)
    if (!current || (row.checkedOn ?? '') >= (current.checkedOn ?? '')) latest.set(key, row)
  })
  return [...latest.values()].flatMap((row) => {
    if (row.checkedOn !== runDate) return []
    if (row.listingStatus === 'listed_pending' || row.listingStatus === 'listing_expired') return []
    if (row.listingStatus === 'listing_check_unknown') return []
    if (!NINETY_PLUS_STATUSES.has(row.listingStatus as ListingStatus)) return []
    if ((row.dom ?? -1) < NINETY_PLUS_DAYS && (row.cdom ?? -1) < NINETY_PLUS_DAYS) return []
    return [{ row, requiresLicenseeDisclosure: true as const, basis: NINETY_PLUS_BASIS }]
  })
}
