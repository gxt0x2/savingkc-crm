export type CountyDelinquency = '2yr' | '3yr_plus'
export type CountyPropertyClass = 'residential' | 'land' | 'unknown'
export type CountyDeceasedFilter = 'all' | 'non_deceased' | 'deceased'
export type CountyPropertyClassFilter = 'all' | CountyPropertyClass

export interface CountyProspectAudienceRow {
  delinquency: CountyDelinquency
  deceased: boolean
  propertyClass: CountyPropertyClass
  total: number
  withPhoneCandidate: number
  linkedLeads: number
}

export interface CountySavedViewDefinition {
  id: 'tax_2yr' | 'tax_3yr_plus'
  label: string
  description: string
  delinquency: CountyDelinquency
}

export interface CountySavedViewSummary extends CountySavedViewDefinition {
  rows: CountyProspectAudienceRow[]
  total: number
  withPhoneCandidate: number
  linkedLeads: number
  needsPropertyClass: number
}

export interface CountySavedViewMetrics {
  total: number
  withPhoneCandidate: number
  linkedLeads: number
}

export const COUNTY_SAVED_VIEW_DEFINITIONS: readonly CountySavedViewDefinition[] = [
  {
    id: 'tax_2yr',
    label: '2-Year Tax Delinquent',
    description: 'County records at the two-year delinquency mark.',
    delinquency: '2yr',
  },
  {
    id: 'tax_3yr_plus',
    label: '3+ Year Tax Delinquent',
    description: 'County records with three or more years of tax delinquency.',
    delinquency: '3yr_plus',
  },
] as const

// Keep legacy dialer links meaningful without preserving their overlapping
// implementation. The former deceased_3yr preset included both 2yr and 3yr+
// rows despite its label; the canonical alias is deliberately 3yr+ only.
export const LEGACY_COUNTY_SAVED_VIEW_ALIASES = {
  tax_2yr: { viewId: 'tax_2yr', deceased: 'all' },
  deceased_3yr: { viewId: 'tax_3yr_plus', deceased: 'deceased' },
} as const satisfies Record<string, { viewId: CountySavedViewDefinition['id']; deceased: CountyDeceasedFilter }>

function totals(rows: CountyProspectAudienceRow[]): CountySavedViewMetrics {
  return rows.reduce<CountySavedViewMetrics>((summary, row) => ({
    total: summary.total + row.total,
    withPhoneCandidate: summary.withPhoneCandidate + row.withPhoneCandidate,
    linkedLeads: summary.linkedLeads + row.linkedLeads,
  }), { total: 0, withPhoneCandidate: 0, linkedLeads: 0 })
}

export function buildCountySavedViews(rows: CountyProspectAudienceRow[]): CountySavedViewSummary[] {
  return COUNTY_SAVED_VIEW_DEFINITIONS.map((definition) => {
    const matchingRows = rows.filter((row) => row.delinquency === definition.delinquency)
    return {
      ...definition,
      rows: matchingRows,
      ...totals(matchingRows),
      needsPropertyClass: matchingRows
        .filter((row) => row.propertyClass === 'unknown')
        .reduce((sum, row) => sum + row.total, 0),
    }
  })
}

export function filterCountySavedView(
  view: CountySavedViewSummary,
  deceased: CountyDeceasedFilter,
  propertyClass: CountyPropertyClassFilter,
): CountySavedViewMetrics {
  const rows = view.rows.filter((row) => {
    if (deceased === 'deceased' && !row.deceased) return false
    if (deceased === 'non_deceased' && row.deceased) return false
    return propertyClass === 'all' || row.propertyClass === propertyClass
  })
  return totals(rows)
}
