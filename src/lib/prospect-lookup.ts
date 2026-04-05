/**
 * Prospect lookup (Tax delinquent properties)
 * TODO: Implement actual prospect lookup logic
 * This is a stub to satisfy TypeScript compilation
 */

export interface ProspectMatch {
  parcel_id: string
  owner_1: string | null
  situs_street: string | null
  situs_address: string | null
  county: string
  cumulative_due: number
  is_deceased: boolean
}

/**
 * Look up prospect by phone number
 * TODO: Implement actual lookup against tax delinquent database
 */
export async function lookupProspectByPhone(phone: string): Promise<ProspectMatch[]> {
  // Stub implementation - returns empty array
  return []
}
