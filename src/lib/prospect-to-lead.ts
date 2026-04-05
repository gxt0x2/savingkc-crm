/**
 * Convert prospects to leads
 * TODO: Implement actual prospect-to-lead conversion logic
 * This is a stub to satisfy TypeScript compilation
 */

import type { ProspectMatch } from './prospect-lookup'

/**
 * Create enriched lead from tax delinquent prospect
 * TODO: Implement actual lead creation with property enrichment
 */
export async function createEnrichedLeadFromProspect(
  prospect: ProspectMatch,
  phone: string,
  source: string,
  priority: 'hot' | 'warm' | 'cold'
): Promise<string | null> {
  // Stub implementation - returns null
  return null
}

/**
 * Format prospect alert message
 * TODO: Implement actual formatting
 */
export function formatProspectAlert(prospect: ProspectMatch): string {
  // Stub implementation
  return `Property: ${prospect.situs_street || 'Unknown'}, Owed: $${prospect.cumulative_due || 0}`
}
