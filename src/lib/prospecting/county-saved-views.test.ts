import { describe, expect, it } from 'vitest'
import {
  buildCountySavedViews,
  filterCountySavedView,
  LEGACY_COUNTY_SAVED_VIEW_ALIASES,
  type CountyProspectAudienceRow,
} from './county-saved-views'

const rows: CountyProspectAudienceRow[] = [
  { delinquency: '2yr', deceased: false, propertyClass: 'residential', total: 10, withPhoneCandidate: 7, linkedLeads: 2 },
  { delinquency: '2yr', deceased: true, propertyClass: 'unknown', total: 4, withPhoneCandidate: 2, linkedLeads: 1 },
  { delinquency: '3yr_plus', deceased: false, propertyClass: 'land', total: 3, withPhoneCandidate: 1, linkedLeads: 0 },
  { delinquency: '3yr_plus', deceased: true, propertyClass: 'unknown', total: 8, withPhoneCandidate: 5, linkedLeads: 3 },
]

describe('county saved views', () => {
  it('separates 2-year and 3+ records without hiding unknown property classes', () => {
    const views = buildCountySavedViews(rows)

    expect(views).toMatchObject([
      { id: 'tax_2yr', total: 14, withPhoneCandidate: 9, linkedLeads: 3, needsPropertyClass: 4 },
      { id: 'tax_3yr_plus', total: 11, withPhoneCandidate: 6, linkedLeads: 3, needsPropertyClass: 8 },
    ])
  })

  it('applies deceased and property-class filters beneath a saved view', () => {
    const view = buildCountySavedViews(rows)[1]

    expect(filterCountySavedView(view, 'deceased', 'all')).toEqual({ total: 8, withPhoneCandidate: 5, linkedLeads: 3 })
    expect(filterCountySavedView(view, 'all', 'land')).toEqual({ total: 3, withPhoneCandidate: 1, linkedLeads: 0 })
    expect(filterCountySavedView(view, 'non_deceased', 'residential')).toEqual({ total: 0, withPhoneCandidate: 0, linkedLeads: 0 })
  })

  it('maps the valid legacy source presets to non-overlapping canonical views', () => {
    expect(LEGACY_COUNTY_SAVED_VIEW_ALIASES).toEqual({
      tax_2yr: { viewId: 'tax_2yr', deceased: 'all' },
      deceased_3yr: { viewId: 'tax_3yr_plus', deceased: 'deceased' },
    })
  })
})
