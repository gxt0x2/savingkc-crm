// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MyDayData, MyDayDateRange } from '@/lib/my-day'

import { MyDayDateRangeSelector, ReconciliationAttention } from './my-day-workspace'

afterEach(() => vi.unstubAllGlobals())

const todayRange: MyDayDateRange = {
  preset: 'today',
  from: '2026-08-24',
  to: '2026-08-24',
  label: 'Today',
}

describe('My Day date range selector', () => {
  it('presents Today as the compact default and offers useful reporting windows', () => {
    const onChange = vi.fn()
    render(<MyDayDateRangeSelector range={todayRange} today="2026-08-24" loading={false} onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'Date range: Today' })).toHaveTextContent('Aug 24, 2026')
    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))

    const dialog = screen.getByRole('dialog', { name: 'Choose reporting date range' })
    expect(within(dialog).getByRole('button', { name: /Today/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: /This week/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Last 7 days/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Month to date/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Previous month/ })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /This week/ }))
    expect(onChange).toHaveBeenCalledWith({ preset: 'this_week' })
  })

  it('submits an explicit custom date range', () => {
    const onChange = vi.fn()
    render(<MyDayDateRangeSelector range={todayRange} today="2026-08-24" loading={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Date range: Today' }))
    fireEvent.change(screen.getByLabelText('Custom range start'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('Custom range end'), { target: { value: '2026-08-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }))

    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', from: '2026-08-01', to: '2026-08-24' })
  })
})

describe('My Day reconciliation attention', () => {
  it('separates record navigation from durable review acknowledgement', async () => {
    const onReviewed = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, recordId: 'mojo-record' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const data = {
      attention: {
        status: 'available',
        items: [{
          id: 'mojo:mojo-record',
          recordId: 'mojo-record',
          leadId: 'lead-one',
          leadName: 'Seller One',
          property: '1 Main St',
          happenedAt: '2026-08-25T15:13:00.000Z',
          disposition: 'Callback Requested',
          kind: 'terminal_record_activity',
          missingFollowUpAt: true,
          href: '/leads/lead-one',
        }],
      },
    } as MyDayData

    render(<ReconciliationAttention data={data} onReviewed={onReviewed} />)

    expect(screen.getByRole('link', { name: /Open record/ })).toHaveAttribute('href', '/leads/lead-one')
    fireEvent.click(screen.getByRole('button', { name: /Mark reviewed/ }))

    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith('mojo:mojo-record'))
    expect(fetchMock).toHaveBeenCalledWith('/api/my-day', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ recordId: 'mojo-record' }),
    }))
  })
})
