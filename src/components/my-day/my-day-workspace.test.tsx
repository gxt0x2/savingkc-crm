// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MyDayData, MyDayDateRange } from '@/lib/my-day'

import { MojoFreshnessAlert, MyDayDateRangeSelector, ReconciliationAttention, WeeklySnapshot } from './my-day-workspace'

beforeEach(() => {
  const values = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
})

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

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

describe('My Day Mojo freshness alert', () => {
  it('shows a friendly last-update time with clear and report actions', () => {
    const data = {
      performance: {
        freshness: {
          status: 'stale',
          message: 'Mojo provider performance was last updated Sep 7, 5:59 PM',
          lastSuccessfulSyncAt: '2026-09-07T22:59:00.000Z',
          ageMinutes: 1_400,
        },
      },
    } as MyDayData

    render(<MojoFreshnessAlert data={data} />)

    expect(screen.getByRole('alert', { name: 'Mojo data freshness' })).toHaveTextContent('Today’s provider totals are withheld')
    expect(screen.getByText(/last updated Sep 7, 5:59 PM/)).toBeInTheDocument()
    expect(screen.queryByText(/2026-09-08/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Report Andon issue' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Clear notification' })).toBeVisible()
  })

  it('keeps the current alert cleared across a remount', async () => {
    const data = {
      performance: {
        freshness: {
          status: 'delayed',
          message: 'Mojo sync is stale by 60 minutes',
          lastSuccessfulSyncAt: '2026-09-07T22:59:00.000Z',
          ageMinutes: 60,
        },
      },
    } as MyDayData

    const first = render(<MojoFreshnessAlert data={data} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear notification' }))
    expect(screen.queryByRole('alert', { name: 'Mojo data freshness' })).not.toBeInTheDocument()

    first.unmount()
    render(<MojoFreshnessAlert data={{
      ...data,
      performance: {
        ...data.performance,
        freshness: { ...data.performance.freshness, message: 'Mojo sync is stale by 61 minutes', ageMinutes: 61 },
      },
    }} />)
    await waitFor(() => expect(screen.queryByRole('alert', { name: 'Mojo data freshness' })).not.toBeInTheDocument())
  })
})

describe('My Day workweek calendar', () => {
  it('labels the Labor Day column as a non-workday', () => {
    const data = {
      week: {
        start: '2026-09-07',
        end: '2026-09-11',
        dayLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        rows: [{ key: 'calls', label: 'Calls', icon: 'call', tone: 'blue', days: [null, 5, null, null, null], total: 5 }],
      },
    } as MyDayData

    render(<WeeklySnapshot data={data} />)

    expect(screen.getByRole('columnheader', { name: 'Mon Labor Day' })).toBeVisible()
    expect(screen.getByRole('cell', { name: 'Labor Day — not a workday' })).toHaveTextContent('—')
  })
})
