/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { bundledWholesaleMarketSnapshots } from '@/lib/market-watch/catalog'

import { MarketWatchView } from './market-watch-view'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/hooks/use-is-admin', () => ({ useIsAdmin: () => ({ isAdmin: false, loading: false }) }))

const [august] = bundledWholesaleMarketSnapshots()

function zipTable() {
  return screen.getByRole('table', { name: /Wholesale-fit ZIP codes/ })
}

describe('Market Watch view', () => {
  it('shows the August analyst report and filters the zip table', () => {
    render(<MarketWatchView snapshots={[august]} />)

    expect(screen.getByRole('heading', { name: 'Saving KC Wholesale Market Watch — August 2026' })).toBeVisible()
    expect(screen.getByText('2,315')).toBeVisible()
    expect(screen.getByText('5,187')).toBeVisible()
    expect(screen.getAllByText('2.24').length).toBeGreaterThan(0)
    expect(screen.getByText('$465,173')).toBeVisible()
    expect(screen.getByText(/Do not dump these zips as CRM leads/)).toBeVisible()
    expect(screen.getByText(/64125/)).toBeVisible()
    expect(screen.getByText(/64131/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save snapshot' })).not.toBeInTheDocument()

    const table = zipTable()
    expect(within(table).getAllByRole('row')).toHaveLength(29)
    expect(within(table).getByRole('row', { name: /64118/ })).toHaveTextContent('57')
    expect(within(table).getByRole('row', { name: /66202/ })).toHaveTextContent('0.61')

    fireEvent.change(screen.getByLabelText('Search ZIP'), { target: { value: '66202' } })
    expect(screen.getByText('Showing 1 of 28')).toBeVisible()
    expect(within(zipTable()).getAllByRole('row')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Search ZIP'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('County'), { target: { value: 'Jackson MO' } })
    expect(screen.getByText('Showing 10 of 28')).toBeVisible()

    fireEvent.change(screen.getByLabelText('County'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('MOI band'), { target: { value: 'Soft' } })
    expect(screen.getByText('Showing 3 of 28')).toBeVisible()
    expect(within(zipTable()).getByRole('row', { name: /64133/ })).toBeVisible()

    fireEvent.change(screen.getByLabelText('MOI band'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Primary targets only' }))
    expect(screen.getByText(/Showing 17 of 28/)).toBeVisible()
    expect(within(zipTable()).queryByRole('row', { name: /64133/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ZIP/ }))
    expect(within(zipTable()).getAllByRole('row')[1]).toHaveTextContent('64014')
  })
})
