/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PropertyHero } from './property-hero'

vi.mock('@/components/leads/google-map-panel', () => ({
  StreetViewPanel: () => <div>Street View</div>,
}))

const property = {
  address: '123 Main St',
  city: 'Kansas City',
  state: 'MO',
  zip: '64108',
  beds: 3,
  baths: 2,
  sqft: 1_500,
  yearBuilt: 1950,
  lotSize: '0.2',
  tags: [],
}

describe('PropertyHero valuation sources', () => {
  it('shows source-specific values and only requests Redfin after an explicit click', () => {
    const onRefreshRedfin = vi.fn()
    render(
      <PropertyHero
        property={property}
        zestimate={245_000}
        redfinEstimate={238_000}
        assessedValue={180_000}
        onRefreshRedfin={onRefreshRedfin}
      />,
    )

    expect(screen.getByRole('region', { name: 'Property valuation sources' })).toHaveTextContent('$245k')
    expect(screen.getByRole('region', { name: 'Property valuation sources' })).toHaveTextContent('$238k')
    expect(onRefreshRedfin).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Redfin estimate' }))
    expect(onRefreshRedfin).toHaveBeenCalledTimes(1)
  })

  it('truthfully exposes an unavailable result and disables repeated requests while loading', () => {
    render(
      <PropertyHero
        property={property}
        redfinLoading
        redfinError="Redfin could not return an estimate right now. Try again later."
        onRefreshRedfin={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Checking Redfin…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Redfin could not return an estimate right now')
  })
})
