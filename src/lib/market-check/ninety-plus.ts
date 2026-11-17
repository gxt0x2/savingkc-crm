import type { ListingStatus } from '@/lib/market-check/plan'

export const NINETY_PLUS_DAYS = 90

const NINETY_PLUS_STATUSES = new Set<ListingStatus>(['listed_active', 'listed_withdrawn'])

export interface NinetyPlusCandidate {
  listingStatus: ListingStatus | string
  dom: number | null
  cdom: number | null
  listingAgentName?: string | null
  listingAgentPhone?: string | null
}

/**
 * Active or withdrawn listings with DOM or CDOM of 90 or more.
 * Pending and under-contract rows are listed_pending and stay out.
 * A confirmed expired stays on the expired lane.
 * This lane is not a license-risk block. The offer goes through the listing agent.
 */
export function selectNinetyPlusDays<T extends NinetyPlusCandidate>(rows: readonly T[]): T[] {
  return rows.filter((row) => {
    if (row.listingStatus === 'listed_pending' || row.listingStatus === 'listing_expired') return false
    if (!NINETY_PLUS_STATUSES.has(row.listingStatus as ListingStatus)) return false
    return (row.dom ?? -1) >= NINETY_PLUS_DAYS || (row.cdom ?? -1) >= NINETY_PLUS_DAYS
  })
}
