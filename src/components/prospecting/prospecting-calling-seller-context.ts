import {
  formatOwnerDisplayName,
  joinOwnerAddress,
  resolveMailingDisplay,
  resolveSitusDisplay,
} from '@/lib/owner-display'
import type {
  ProspectingCallingLead,
  ProspectingCallingProspect,
  ProspectingOccupancy,
} from '@/components/prospecting/prospecting-calling-types'

export function resolveProspectingCallingSellerContext(
  prospect: ProspectingCallingProspect | null,
  lead: ProspectingCallingLead | null,
) {
  const ownerName = formatOwnerDisplayName(prospect, lead?.full_name) || 'Unknown'
  const situsAddress = joinOwnerAddress(resolveSitusDisplay(prospect, {
    street: lead?.property_address,
    city: lead?.city,
    state: lead?.state,
    zip: lead?.zip,
  }))

  // Occupancy is a source-backed prospect fact. Mailing-vs-situs remains a
  // deterministic fallback for older county rows that predate the column.
  const occupancy = resolveOccupancy(prospect, situsAddress)
  const delinquentYears = prospect?.delinquent_years_category === '3yr_plus'
    ? '3+ yr'
    : prospect?.delinquent_years_category === '2yr'
      ? '2 yr'
      : null

  return { ownerName, situsAddress, occupancy, delinquentYears }
}

function resolveOccupancy(
  prospect: ProspectingCallingProspect | null,
  situsAddress: string,
): ProspectingOccupancy | null {
  const sourceStatus = prospect?.occupancy_status?.trim().toLowerCase()
  if (sourceStatus === 'vacant') return { label: 'Vacant', tone: 'warn' }
  if (sourceStatus === 'absentee' || sourceStatus === 'non_owner_occupied') return { label: 'Absentee', tone: 'amber' }
  if (sourceStatus === 'owner_occupied' || sourceStatus === 'occupied') return { label: 'Owner occupied', tone: 'neutral' }
  const mailing = joinOwnerAddress(resolveMailingDisplay(prospect))
  if (!mailing) return null
  if (mailing !== situsAddress) return { label: 'Absentee', tone: 'amber' }
  return { label: 'Owner occupied', tone: 'neutral' }
}
