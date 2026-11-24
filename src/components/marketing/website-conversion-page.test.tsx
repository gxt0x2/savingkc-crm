/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildWebsiteConversionReport } from '@/lib/marketing/website-conversion'

import { WebsiteConversionPage } from './website-conversion-page'

const navigation = vi.hoisted(() => ({
  range: 'day',
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/marketing/website-conversion',
  useSearchParams: () => new URLSearchParams(navigation.range ? `range=${navigation.range}` : ''),
  useRouter: () => ({ replace: navigation.replace }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

const NOW = new Date('2026-10-25T15:00:00.000Z')

function readyReport() {
  return buildWebsiteConversionReport({
    range: 'day',
    now: NOW,
    syncRuns: [
      { source: 'ga4', mode: 'nightly', started_at: '2026-10-25T08:17:00.000Z', finished_at: '2026-10-25T08:17:20.000Z', since_date: '2026-10-22', until_date: '2026-10-24', status: 'ok', rows_upserted: 4, error: null },
      { source: 'gsc', mode: 'nightly', started_at: '2026-10-25T08:17:00.000Z', finished_at: '2026-10-25T08:17:40.000Z', since_date: '2026-10-22', until_date: '2026-10-24', status: 'ok', rows_upserted: 2, error: null },
    ],
    ga4Rows: [
      { date: '2026-10-24', landing_page: '/call', session_source_medium: '(direct) / (none)', sessions: 30, engaged_sessions: 1 },
      { date: '2026-10-24', landing_page: '/about-us', session_source_medium: 'chatgpt.com / ai-assistant', sessions: 4, engaged_sessions: 3 },
    ],
    gscRows: [{ date: '2026-10-24', page: 'https://savingkc.com/call', clicks: 2, impressions: 20, position: 6 }],
    leads: [],
    events: [{ event_name: 'phone_click', event_time: '2026-10-24T16:00:00.000Z', session_id: 's1', is_test: false }],
  })
}

describe('website conversion board', () => {
  beforeEach(() => {
    navigation.range = 'day'
    navigation.replace.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('shows a blank metric instead of zero when the warehouse has not synced', async () => {
    const report = buildWebsiteConversionReport({
      range: 'day',
      now: NOW,
      ga4Rows: null,
      gscRows: null,
      leads: null,
      events: null,
    })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(report), { status: 200 }))

    render(<WebsiteConversionPage />)

    expect(await screen.findByRole('heading', { name: 'Website conversion' })).toBeVisible()
    const sessions = screen.getAllByText('Sessions')[0]?.parentElement
    expect(sessions).toHaveTextContent('Not synced')
    expect(sessions).not.toHaveTextContent(/\b0\b/)
    expect(screen.getByText('Page rules stay quiet until GA4 rows exist for this range.')).toBeVisible()
    expect(fetch).toHaveBeenCalledWith('/api/marketing/website-conversion?range=day', expect.objectContaining({ cache: 'no-store' }))
  })

  it('renders warehouse totals, source split, and the rule panel for a synced day', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(readyReport()), { status: 200 }))
    render(<WebsiteConversionPage />)

    expect(await screen.findByText('34')).toBeVisible()
    expect(screen.getByText('chatgpt.com / ai-assistant')).toBeVisible()
    expect(screen.getByText('/call is bouncing')).toBeVisible()
    expect(screen.getByText('Form conversion is 0%')).toBeVisible()
    expect(screen.getByText('About form sits below the fold')).toBeVisible()
    expect(screen.getAllByRole('cell', { name: '/call' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Saving KC Homebuyers, founded 2014. (816) 429-2900 · support@savingkc.com. This board reads the site warehouse. It does not buy media.')).toBeVisible()
  })

  it('requests the selected range without leaving the board', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(readyReport()), { status: 200 }))
    render(<WebsiteConversionPage />)
    await screen.findByText('/call is bouncing')

    fireEvent.click(screen.getByRole('radio', { name: 'Week' }))

    expect(navigation.replace).toHaveBeenCalledWith('/marketing/website-conversion?range=week', { scroll: false })
  })
})
