/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PropertyDetailsCard, type PropertyHousingDetails } from './property-details-card'

const details: PropertyHousingDetails = {
  beds: null,
  baths_full: null,
  baths_half: null,
  sqft: null,
  lot_size: null,
  year_built: null,
  basement_type: null,
  stories: null,
  garage_spaces: null,
  roof_type: null,
  heating: null,
  cooling: null,
  property_type: null,
  zoning: null,
  hoa_amount: null,
  tax_assessment: null,
  tax_owed: null,
  first_delinquent_year: 2023,
  last_sale_date: null,
  last_sale_price: null,
  data_source: 'prospect_match',
  data_enriched_at: '2026-08-26T12:00:00.000Z',
}

describe('PropertyDetailsCard re-enrich action', () => {
  it('exposes a Re-enrich control that force-refreshes county details', () => {
    const onReenrich = vi.fn()
    render(<PropertyDetailsCard details={details} onReenrich={onReenrich} />)

    fireEvent.click(screen.getByRole('button', { name: 'Re-enrich property details' }))

    expect(onReenrich).toHaveBeenCalledOnce()
    expect(screen.getByText(/Last enriched/)).toBeInTheDocument()
  })

  it('disables the action while a refresh is in flight', () => {
    render(
      <PropertyDetailsCard
        details={details}
        onReenrich={vi.fn()}
        reenriching
        reenrichError="County assessor did not return property details"
      />,
    )

    expect(screen.getByRole('button', { name: 'Re-enriching property details' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('County assessor did not return property details')
  })
})
