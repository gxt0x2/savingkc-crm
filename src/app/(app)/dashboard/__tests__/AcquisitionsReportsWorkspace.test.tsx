/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AcquisitionsReportsWorkspace, moneyShort, rate, stageHref } from '../components/AcquisitionsReportsWorkspace'

const { useQueryMock, useSearchParamsMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock }))
vi.mock('next/navigation', () => ({ useSearchParams: useSearchParamsMock }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

const contacts = [
  { id: 'new', station: 'new', score: 20, isFavorite: false, source: 'google_ads', phone: '8165551000', email: null, createdAt: '2026-07-20T12:00:00Z', firstOutboundAt: '2026-07-20T12:10:00Z', lastContactAt: null },
  { id: 'qualified', station: 'qualified', score: 82, isFavorite: false, source: 'google_ads', phone: null, email: 'seller@example.com', createdAt: '2026-04-01T12:00:00Z', firstOutboundAt: '2026-04-01T12:20:00Z', lastContactAt: '2026-07-01T12:00:00Z' },
  { id: 'appointment', station: 'appointment_set', score: 66, isFavorite: false, source: 'referral', phone: '8165552000', email: 'owner@example.com', createdAt: '2026-03-01T12:00:00Z', firstOutboundAt: '2026-03-01T12:05:00Z', lastContactAt: '2026-07-25T12:00:00Z' },
  { id: 'offer', station: 'offer_made', score: 74, isFavorite: false, source: 'referral', phone: '8165553000', email: 'offer@example.com', createdAt: '2026-02-01T12:00:00Z', firstOutboundAt: null, lastContactAt: '2026-07-26T12:00:00Z' },
  { id: 'contract', station: 'under_contract', score: 70, isFavorite: true, source: 'direct_mail', phone: '8165554000', email: 'contract@example.com', createdAt: '2026-01-05T12:00:00Z', firstOutboundAt: null, lastContactAt: '2026-07-29T12:00:00Z' },
  { id: 'closed', station: 'closed_won', score: 90, isFavorite: false, source: 'google_ads', phone: '8165555000', email: 'closed@example.com', createdAt: '2026-01-02T12:00:00Z', firstOutboundAt: null, lastContactAt: '2026-07-30T12:00:00Z' },
]

const threads = [
  { id: 'new', attentionState: 'needs_reply', owner: null, lastActivityAt: null, primaryNextAction: null },
  { id: 'qualified', attentionState: 'waiting_on_contact', owner: 'Casey', lastActivityAt: '2026-07-01T12:00:00Z', primaryNextAction: { overdue: true } },
  { id: 'appointment', attentionState: 'resolved', owner: 'Casey', lastActivityAt: '2026-07-25T12:00:00Z', primaryNextAction: { overdue: false } },
  { id: 'offer', attentionState: 'resolved', owner: 'Ernest', lastActivityAt: '2026-07-26T12:00:00Z', primaryNextAction: { overdue: false } },
  { id: 'contract', attentionState: 'resolved', owner: 'Ernest', lastActivityAt: '2026-07-29T12:00:00Z', primaryNextAction: { overdue: false } },
  { id: 'closed', attentionState: 'resolved', owner: 'Ernest', lastActivityAt: '2026-07-30T12:00:00Z', primaryNextAction: { overdue: false } },
]

const reportData = {
  contacts,
  threads,
  ytd: {
    agent: 'Casey Davis',
    monthly: [
      { month: 'Jan 2026', dialTimeHrs: 20, calls: 100, contacts: 20, leads: 5, appointments: 2 },
      { month: 'Feb 2026', dialTimeHrs: 25, calls: 125, contacts: 30, leads: 8, appointments: 3 },
    ],
    ytd: { dialTimeHrs: 45, calls: 225, contacts: 50, leads: 13, appointments: 5, contactRate: '22.2', leadRate: '26.0', months: 2 },
  },
  appointments: { showRate30Day: 88, totalAppointments: 10, completed: 7, noShows: 1, cancelled: 2, ghostProtocolRecoveryRate: 50 },
  financials: { total: { revenue: 17280, expenses: 4000, net: 13280 } },
}

function setView(view: string | null) {
  useSearchParamsMock.mockReturnValue({ get: (key: string) => key === 'view' ? view : null })
}

function setQueryResult(overrides: Record<string, unknown> = {}) {
  useQueryMock.mockReturnValue({ data: reportData, error: null, isLoading: false, isFetching: false, refetch: vi.fn(), ...overrides })
}

describe('AcquisitionsReportsWorkspace', () => {
  beforeEach(() => {
    setView(null)
    setQueryResult()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('defaults to the acquisitions command center and exposes exact drill-downs', () => {
    render(<AcquisitionsReportsWorkspace />)

    expect(screen.getByRole('heading', { name: 'Acquisitions command center' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Needs reply/ })).toHaveAttribute('href', '/contacts?list=needs_reply')
    expect(screen.getByRole('link', { name: /Stale 7\+ days/ })).toHaveAttribute('href', '/contacts?activity=stale')
    expect(screen.getByRole('heading', { name: 'Contracts → Closed' })).toBeInTheDocument()
    expect(screen.getByText('Casey Davis — KPI tracker')).toBeInTheDocument()
    expect(screen.getByText('Model the next constraint before changing the operation')).toBeInTheDocument()
  })

  it('changes the reporting period and recalculates the visible source cohort', () => {
    render(<AcquisitionsReportsWorkspace />)

    const period = screen.getByRole('combobox')
    fireEvent.change(period, { target: { value: '30d' } })
    expect(period).toHaveValue('30d')
    expect(screen.queryByText('Direct Mail')).not.toBeInTheDocument()
    fireEvent.change(period, { target: { value: 'all' } })
    expect(period).toHaveValue('all')
    expect(screen.getByText('Google Ads')).toBeInTheDocument()
    expect(screen.getByText('Direct Mail')).toBeInTheDocument()
  })

  it.each([
    ['overview', 'Operating overview'],
    ['agents', 'Agent performance'],
    ['marketing', 'Marketing performance'],
    ['dispositions', 'Disposition performance'],
    ['data-quality', 'Data quality'],
    ['not-a-view', 'Acquisitions command center'],
  ])('renders the %s report view', (view, heading) => {
    setView(view)
    render(<AcquisitionsReportsWorkspace />)
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('renders data-quality links and post-close operating guidance', () => {
    setView('data-quality')
    render(<AcquisitionsReportsWorkspace />)
    expect(screen.getByRole('link', { name: /Missing phone/ })).toHaveAttribute('href', '/contacts?gap=missing_phone')
    expect(screen.getByRole('link', { name: /Missing next action/ })).toHaveAttribute('href', '/contacts?gap=missing_next_action')
    cleanup()

    setView('dispositions')
    setQueryResult({ data: { ...reportData, financials: { total: { revenue: 500, expenses: 1000, net: -500 } } } })
    render(<AcquisitionsReportsWorkspace />)
    expect(screen.getByText('Closeout → financial reconciliation → debrief → workflow improvement')).toBeInTheDocument()
    expect(screen.getByText('-$500')).toBeInTheDocument()
  })

  it('shows an intentional empty state when the reporting period has no source data', () => {
    setView('marketing')
    setQueryResult({ data: { ...reportData, contacts: [], threads: [] } })
    render(<AcquisitionsReportsWorkspace />)
    expect(screen.getByText('No source data in this reporting period.')).toBeInTheDocument()
  })

  it('distinguishes overdue workload from contact-rate coaching priorities', () => {
    const pluralOverdueThreads = threads.map((thread) => (
      thread.id === 'appointment' ? { ...thread, primaryNextAction: { overdue: true } } : thread
    ))
    setView('agents')
    setQueryResult({ data: { ...reportData, threads: pluralOverdueThreads } })
    const { rerender } = render(<AcquisitionsReportsWorkspace />)
    expect(screen.getByText('Clear 2 overdue actions before adding more calling volume.')).toBeInTheDocument()

    const currentThreads = threads.map((thread) => ({ ...thread, primaryNextAction: { overdue: false } }))
    setQueryResult({ data: { ...reportData, threads: currentThreads, ytd: { ...reportData.ytd, ytd: { ...reportData.ytd.ytd, contactRate: '5' } } } })
    rerender(<AcquisitionsReportsWorkspace />)
    expect(screen.getByText('Contact rate is the coaching priority. Review calling windows, list quality, and number reputation.')).toBeInTheDocument()

    setQueryResult({ data: { ...reportData, threads: currentThreads } })
    rerender(<AcquisitionsReportsWorkspace />)
    expect(screen.getByText('Execution is current. Coach for stronger qualification and stage advancement.')).toBeInTheDocument()
  })

  it('handles missing optional KPI services without losing the core report', () => {
    setView('agents')
    setQueryResult({ data: { ...reportData, ytd: null, appointments: null, financials: null } })
    render(<AcquisitionsReportsWorkspace />)
    expect(screen.getByRole('heading', { name: 'Agent performance' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '30-day show rate' })).toBeInTheDocument()
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  it('shows loading and recoverable required-data errors', () => {
    setQueryResult({ data: undefined, isLoading: true })
    const { rerender } = render(<AcquisitionsReportsWorkspace />)
    expect(screen.getByLabelText('Loading reports')).toBeInTheDocument()

    const refetch = vi.fn()
    setQueryResult({ data: undefined, isLoading: false, error: new Error('offline'), refetch })
    rerender(<AcquisitionsReportsWorkspace />)
    expect(screen.getByRole('heading', { name: 'Acquisitions reporting is temporarily unavailable' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('loads required and optional report sources in parallel', async () => {
    let queryFn: (() => Promise<unknown>) | null = null
    useQueryMock.mockImplementation((options: { queryFn: () => Promise<unknown> }) => {
      queryFn = options.queryFn
      return { data: reportData, error: null, isLoading: false, isFetching: true, refetch: vi.fn() }
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/contacts') return { ok: true, json: async () => ({ items: contacts }) }
      if (url === '/api/conversations/hub') return { ok: true, json: async () => ({ items: threads }) }
      if (url === '/api/dashboard/appointment-stats') return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<AcquisitionsReportsWorkspace />)

    expect(queryFn).not.toBeNull()
    const result = await queryFn!() as { contacts: unknown[]; appointments: unknown }
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(result.contacts).toHaveLength(6)
    expect(result.appointments).toBeNull()
  })

  it('rejects an unavailable required data source and tolerates optional network errors', async () => {
    let queryFn: (() => Promise<unknown>) | null = null
    useQueryMock.mockImplementation((options: { queryFn: () => Promise<unknown> }) => {
      queryFn = options.queryFn
      return { data: reportData, error: null, isLoading: false, isFetching: false, refetch: vi.fn() }
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/contacts') return { ok: false, json: async () => ({}) }
      if (url === '/api/conversations/hub') return { ok: true, json: async () => ({ items: threads }) }
      throw new Error('optional offline')
    }))
    render(<AcquisitionsReportsWorkspace />)

    await expect(queryFn!()).rejects.toThrow('Report data unavailable: /api/contacts')
  })

  it('keeps drill-down and metric formatting helpers predictable at boundaries', () => {
    expect(stageHref('qualified')).toBe('/contacts?min_stage=qualified')
    expect(stageHref('unknown')).toBe('/contacts')
    expect(rate(1, 4)).toBe(25)
    expect(rate(1, 0)).toBe(0)
    expect(moneyShort(1_500_000)).toBe('$1.5m')
    expect(moneyShort(-1_500_000)).toBe('-$1.5m')
    expect(moneyShort(15_000)).toBe('$15.0k')
    expect(moneyShort(-15_000)).toBe('-$15.0k')
    expect(moneyShort(500)).toBe('$500')
    expect(moneyShort(-500)).toBe('-$500')
  })
})
