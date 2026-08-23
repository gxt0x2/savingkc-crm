import { supabase } from '@/lib/supabase-lazy'
import {
  buildCountySavedViews,
  type CountyPropertyClass,
  type CountyProspectAudienceRow,
  type CountySavedViewSummary,
} from '@/lib/prospecting/county-saved-views'

export type { CountyPropertyClass, CountyProspectAudienceRow } from '@/lib/prospecting/county-saved-views'

export interface CountyProspectAudienceSummary {
  rows: CountyProspectAudienceRow[]
  savedViews: CountySavedViewSummary[]
  classified: number
  needsPropertyClass: number
  withPhoneCandidate: number
}

function count(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function propertyClass(value: unknown): CountyPropertyClass {
  return value === 'residential' || value === 'land' ? value : 'unknown'
}

export async function readCountyProspectAudienceSummary(): Promise<CountyProspectAudienceSummary> {
  const { data, error } = await supabase.rpc('county_prospect_audience_summary_v1')
  if (error) throw new Error(error.message)

  const rows = ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    delinquency: row.delinquency === '3yr_plus' ? '3yr_plus' as const : '2yr' as const,
    deceased: row.deceased === true,
    propertyClass: propertyClass(row.property_class),
    total: count(row.total),
    withPhoneCandidate: count(row.with_phone_candidate),
    linkedLeads: count(row.linked_leads),
  }))

  return {
    rows,
    savedViews: buildCountySavedViews(rows),
    classified: rows.filter((row) => row.propertyClass !== 'unknown').reduce((sum, row) => sum + row.total, 0),
    needsPropertyClass: rows.filter((row) => row.propertyClass === 'unknown').reduce((sum, row) => sum + row.total, 0),
    withPhoneCandidate: rows.reduce((sum, row) => sum + row.withPhoneCandidate, 0),
  }
}
