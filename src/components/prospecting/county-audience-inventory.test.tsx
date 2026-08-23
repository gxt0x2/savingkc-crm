/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountyAudienceInventory } from './county-audience-inventory'

afterEach(() => vi.unstubAllGlobals())

describe('CountyAudienceInventory', () => {
  it('shows the four evidence-backed source segments and keeps unknown property classes out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          { delinquency: '2yr', deceased: false, propertyClass: 'residential', total: 11, withPhoneCandidate: 8, linkedLeads: 0 },
          { delinquency: '3yr_plus', deceased: false, propertyClass: 'residential', total: 7, withPhoneCandidate: 5, linkedLeads: 0 },
          { delinquency: '2yr', deceased: true, propertyClass: 'land', total: 3, withPhoneCandidate: 2, linkedLeads: 0 },
          { delinquency: '3yr_plus', deceased: true, propertyClass: 'unknown', total: 41, withPhoneCandidate: 10, linkedLeads: 0 },
        ],
        classified: 21,
        needsPropertyClass: 41,
        withPhoneCandidate: 25,
      }),
    }))

    render(<CountyAudienceInventory />)

    expect(await screen.findByText('2–3 year tax delinquent · Residential')).toBeVisible()
    expect(screen.getByText('2–3 year tax delinquent · Land')).toBeVisible()
    expect(screen.getByText('2–3 year deceased owner · Residential')).toBeVisible()
    expect(screen.getByText('2–3 year deceased owner · Land')).toBeVisible()
    expect(screen.getByText('18')).toBeVisible()
    expect(screen.getByText(/41 records need county property classification/)).toBeVisible()
    expect(screen.getByText(/valuation and occupancy are not used as guesses/i)).toBeVisible()
  })
})
