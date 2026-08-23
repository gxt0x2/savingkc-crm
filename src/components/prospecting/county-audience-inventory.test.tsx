/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountyAudienceInventory } from './county-audience-inventory'

afterEach(() => vi.unstubAllGlobals())

describe('CountyAudienceInventory', () => {
  it('restores separate 2-year and 3+ Saved Views with subordinate filters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          { delinquency: '2yr', deceased: false, propertyClass: 'residential', total: 11, withPhoneCandidate: 8, linkedLeads: 2 },
          { delinquency: '2yr', deceased: true, propertyClass: 'land', total: 3, withPhoneCandidate: 2, linkedLeads: 1 },
          { delinquency: '2yr', deceased: true, propertyClass: 'unknown', total: 5, withPhoneCandidate: 1, linkedLeads: 0 },
          { delinquency: '3yr_plus', deceased: false, propertyClass: 'residential', total: 7, withPhoneCandidate: 5, linkedLeads: 1 },
          { delinquency: '3yr_plus', deceased: true, propertyClass: 'unknown', total: 41, withPhoneCandidate: 10, linkedLeads: 4 },
        ],
        classified: 21,
        needsPropertyClass: 46,
        withPhoneCandidate: 26,
      }),
    }))

    render(<CountyAudienceInventory />)

    const twoYear = await screen.findByRole('button', { name: /2-Year Tax Delinquent/ })
    const threeYear = screen.getByRole('button', { name: /3\+ Year Tax Delinquent/ })
    expect(twoYear).toHaveAttribute('aria-pressed', 'true')
    expect(threeYear).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Deceased' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Residential' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Land' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Needs classification: 5 records, 1 phone candidate' })).toBeVisible()
    expect(screen.getByText(/46 records remain visible under Needs classification/)).toBeVisible()

    fireEvent.click(threeYear)
    fireEvent.click(screen.getByRole('button', { name: 'Deceased' }))

    const selectedSummary = screen.getByText('matching records').parentElement
    expect(selectedSummary).not.toBeNull()
    expect(within(selectedSummary as HTMLElement).getByText('41')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Needs classification: 41 records, 10 phone candidates' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('surfaces an unavailable state without showing misleading zeroes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Projection unavailable' }) }))
    render(<CountyAudienceInventory />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Projection unavailable')
    expect(screen.queryByText('matching records')).not.toBeInTheDocument()
  })
})
