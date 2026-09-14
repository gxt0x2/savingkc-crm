/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProspectingCallingContextRail } from './prospecting-calling-context-rail'

vi.mock('@/components/leads/google-map-panel', () => ({
  StreetViewPanel: ({ address }: { address: string }) => <div>Street View for {address}</div>,
}))

const prospect = {
  id: 'prospect-1',
  owner_1: 'Mary Seller',
  situs_street: '123 Main Street',
  situs_city: 'Kansas City',
  situs_state: 'MO',
  situs_zip: '64108',
  county: 'Jackson',
  is_deceased: true,
  occupancy_status: 'absentee',
  delinquent_years_category: '2-year',
  mailing_street: 'PO Box 55',
  mailing_city: 'Liberty',
  mailing_state: 'MO',
  mailing_zip: '64068',
  cumulative_due: 6_000,
  zestimate: 198_000,
  total_market_value: 144_000,
  earliest_delinquent_year: 2024,
}

const baseProps: React.ComponentProps<typeof ProspectingCallingContextRail> = {
  campaignId: 'campaign-1',
  leadId: null,
  lead: null,
  prospect,
  ownerName: 'Mary Seller',
  situsAddress: '123 Main Street Kansas City, MO 64108',
  coOwners: [],
  occupancy: null,
  delinquentYears: '2 yr',
  durableSessionId: '',
  campaignMemberId: 'member-1',
  presentedPhone: '+18165550123',
  activities: [{
    id: 'activity-1',
    activity_type: 'note',
    description: 'Daughter handles the estate calls.',
    agent: 'Ernest',
    metadata: {
      source: 'prospecting_contact_note',
      prospect_id: 'prospect-1',
      contact_name: 'Helen Seller',
    },
    created_at: '2026-08-26T12:00:00.000Z',
  }],
  onRefreshActivities: vi.fn(),
}

describe('ProspectingCallingContextRail', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('opens on Notes and keeps the approved contact, information, and live-dialer columns', () => {
    render(<ProspectingCallingContextRail {...baseProps} />)

    expect(screen.getByRole('main', { name: 'Current Contact' })).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Prospect information workspace' })).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Persistent live dialer controls' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Notes' })).toBeVisible()
    expect(screen.queryByText(/Auto-linked to live record/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as Lead' })).toBeVisible()
    expect(screen.getByText('Daughter handles the estate calls.')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Seller answer workspace' }).firstElementChild).toHaveClass(
      'items-stretch',
      'lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(11rem,0.72fr)]',
      '2xl:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(15rem,0.72fr)]',
    )
    expect(screen.getByRole('complementary', { name: 'Persistent live dialer controls' })).toHaveClass('lg:sticky', 'lg:top-3')
    expect(screen.getByRole('complementary', { name: 'Persistent live dialer controls' })).not.toHaveClass('lg:col-span-2')
    expect(screen.getByRole('main', { name: 'Current Contact' })).toHaveClass('lg:h-full')
    expect(screen.getByRole('complementary', { name: 'Prospect information workspace' })).toHaveClass('lg:h-full')
    expect(screen.getByRole('tabpanel', { name: 'Street View' })).toHaveClass('flex-1')
    expect(screen.getByRole('tablist', { name: 'Contact tools' })).toHaveClass('prospecting-tool-tabs')
    expect(screen.queryByText('Answer workspace')).not.toBeInTheDocument()
    expect(screen.queryByText(/Capture context without leaving/i)).not.toBeInTheDocument()
  })

  it('switches between Street View and the actual Zillow page with quick Zestimate', () => {
    render(<ProspectingCallingContextRail {...baseProps} />)

    expect(screen.getByRole('tab', { name: 'Street View' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Zillow' }))

    expect(screen.getByText('Quick Zestimate')).toBeVisible()
    expect(screen.getByText('$198k')).toBeVisible()
    const zillow = screen.getByRole('link', { name: /Open the live Zillow page/i })
    expect(zillow).toHaveAttribute('href', expect.stringContaining('zillow.com/homes/123-Main-Street-Kansas-City-MO-64108_rb'))
    expect(zillow).toHaveAttribute('target', '_blank')
  })

  it('keeps the useful property facts and report links under Details', () => {
    render(<ProspectingCallingContextRail {...baseProps} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Details' }))

    expect(screen.getByRole('region', { name: 'Details' })).toBeVisible()
    expect(screen.getByText(/Po Box 55, Liberty, MO 64068/i)).toBeVisible()
    expect(screen.getByRole('link', { name: 'List' })).toHaveAttribute('href', '/prospecting?campaign=campaign-1')
    expect(screen.getByRole('link', { name: 'Report' })).toHaveAttribute('href', '/prospecting/reports?campaign=campaign-1')
    expect(screen.getByRole('link', { name: 'Recordings' })).toHaveAttribute('href', '/prospecting/reports?campaign=campaign-1&view=recordings')
  })

  it('keeps the approved fixed column order without drag controls', () => {
    window.localStorage.setItem('savingkc:prospecting-column-order:v1', JSON.stringify(['information', 'contact', 'dialer']))
    render(<ProspectingCallingContextRail {...baseProps} />)

    expect(screen.queryByRole('button', { name: /Move .* column/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Drag to arrange/i)).not.toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'Current Contact' }).compareDocumentPosition(screen.getByRole('complementary', { name: 'Prospect information workspace' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('marks the currently presented source Prospect as a Lead', async () => {
    const onLeadPromoted = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBeDefined()
      void init
      return {
        ok: true,
        json: async () => ({ lead: { id: 'lead-1', full_name: 'Mary Seller', phone: '+18165550123' } }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ProspectingCallingContextRail {...baseProps} onLeadPromoted={onLeadPromoted} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mark as Lead' }))

    await waitFor(() => expect(onLeadPromoted).toHaveBeenCalledWith(expect.objectContaining({ id: 'lead-1' })))
    expect(fetchMock).toHaveBeenCalledWith('/api/prospecting/prospects/prospect-1/promote', expect.objectContaining({ method: 'POST' }))
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      campaignMemberId: 'member-1',
      presentedPhone: '+18165550123',
    })
    expect(screen.getByRole('button', { name: 'Marked as Lead' })).toBeDisabled()
  })

  it('shows all quick-action tabs while locking writes in preview', () => {
    render(<ProspectingCallingContextRail {...baseProps} readOnlyPreview />)

    expect(screen.getByRole('tab', { name: 'Follow-up' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Appointment' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Mail' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Mark as Lead' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Follow-up' }))
    expect(screen.getByRole('button', { name: 'Add follow-up' })).toBeDisabled()
  })
})
