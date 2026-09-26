/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForeclosureDetail } from './foreclosure-detail'
import { ForeclosureWorkspace } from './foreclosure-workspace'

const navigation = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('@/components/conversations/workspace-frame', () => ({
  WorkspaceChrome: ({ commandBar }: { commandBar?: React.ReactNode }) => <div>{commandBar}</div>,
}))

vi.mock('@/components/ui/icon', () => ({
  Icon: () => null,
}))

vi.mock('./foreclosure-map', () => ({
  ForeclosureMap: ({ pins }: { pins: Array<{ id: string; ownerName: string }> }) => (
    <div role="region" aria-label="Foreclosure sale map">
      {pins.map((pin) => <a key={pin.id} href={`/prospecting/foreclosure/${pin.id}`}>{`Open ${pin.ownerName}`}</a>)}
    </div>
  ),
}))

const prospect = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ownerName: 'Ernest Dodson',
  ownerEntity: 'person',
  situs: '100 Sandbox Court',
  city: 'Kansas City',
  state: 'MO',
  zip: '64108',
  county: 'jackson',
  saleDate: '2026-10-15',
  noticeOrFilingDate: '2026-09-01',
  noticesSent: 1,
  caseNumber: 'SANDBOX-FC-001',
  status: 'callable',
  noticeLifecycle: 'scheduled_sale',
  saleTime: null,
  saleLocation: null,
  sourceName: 'Sandbox notice',
  sourceUrl: null,
  plaintiffLender: 'Sandbox Lender',
  trusteeOrFirm: null,
  estValue: 240000,
  estValueSource: 'manual',
  estDebt: 90000,
  estDebtSource: 'notice',
  estEquity: 150000,
  equityBand: 'strong_100k+',
  priority: true,
  preferable: true,
  phones: ['+19137179716'],
  noticeNumber: 1,
  skipPhones: [
    { phone: '+19137179716', contactName: 'Ernest Dodson', relationship: 'subject', rank: 1 },
    { phone: '+19135550101', contactName: 'Morgan Dodson', relationship: 'spouse', rank: 2 },
    { phone: '+19135550102', contactName: 'Riley Dodson', relationship: 'child', rank: 3 },
  ],
  latitude: 39.084,
  longitude: -94.585,
  email: 'savingkc@gmail.com',
  deceased: false,
  skiptraceVendor: 'smartskip',
  skiptraceDate: null,
  dialReady: true,
  dialBlockers: [],
  prospectId: null,
  leadId: null,
  notes: null,
}

describe('foreclosure prospecting workspace', () => {
  beforeEach(() => {
    navigation.push.mockReset()
    vi.restoreAllMocks()
  })

  it('lists a dial-ready mortgage prospect and opens the existing calling floor', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/call')) {
        return new Response(JSON.stringify({ href: '/prospecting?prospect_ids=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&queue_label=Mortgage+Foreclosure' }), { status: 200 })
      }
      expect(init?.method ?? 'GET').toBe('GET')
      return new Response(JSON.stringify({ prospects: [prospect] }), { status: 200 })
    })
    render(<ForeclosureWorkspace />)
    expect(await screen.findByRole('link', { name: 'Ernest Dodson' })).toHaveAttribute('href', `/prospecting/foreclosure/${prospect.id}`)
    expect(screen.getByRole('button', { name: 'Sale this week' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Status: New' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Foreclosure prospects' })
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Street' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'County · ST' })).toBeInTheDocument()
    expect(within(table).getByText('100 Sandbox Court')).toBeInTheDocument()
    expect(within(table).getByText('Jackson MO')).toBeInTheDocument()
    expect(within(table).getByText('Callable')).toBeInTheDocument()
    expect(within(table).getByText('$150,000')).toBeInTheDocument()
    expect(within(table).getByText('$90,000')).toBeInTheDocument()
    expect(within(table).getByText('10/15/2026')).toBeInTheDocument()
    expect(within(table).queryByText('2026-10-15')).not.toBeInTheDocument()
    expect(within(table).queryByText('Days to auction')).not.toBeInTheDocument()
    expect(within(table).queryByText('LTV')).not.toBeInTheDocument()
    expect(within(table).queryByText('Phones held')).not.toBeInTheDocument()
    expect(within(table).queryByText('Not dial-ready')).not.toBeInTheDocument()
    expect(within(table).queryByText('1st notice')).not.toBeInTheDocument()
    expect(screen.queryByText(/Jackson MO and Johnson KS first/)).not.toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Days' })).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Notice' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('new')
    expect(within(table).getByText('(913) 717-9716')).toBeInTheDocument()
    expect(screen.queryByText(/sorts first/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Owner is a person/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Foreclosure sale map' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Ernest Dodson' })).toHaveAttribute('href', `/prospecting/foreclosure/${prospect.id}`)
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', `/prospecting/foreclosure/${prospect.id}`)
    expect(screen.getByRole('link', { name: 'Foreclosure' })).toHaveAttribute('href', '/prospecting/foreclosure')
    fireEvent.click(within(table).getByText('100 Sandbox Court'))
    expect(navigation.push).toHaveBeenCalledWith(`/prospecting/foreclosure/${prospect.id}`)
    expect(within(table).queryByRole('button', { name: 'Call' })).not.toBeInTheDocument()
  })

  it('sorts the queue from the sale date and equity headers and keeps a missing owner to a dash', async () => {
    const second = {
      ...prospect,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ownerName: 'UNKNOWN',
      situs: '7125 Park Rd, Kansas City, MO 64129, Kansas City MO',
      zip: '64129',
      saleDate: '2026-11-02',
      estEquity: 400000,
      estDebt: null,
      phones: [],
      dialReady: false,
      noticeType: 'nod',
      status: 'new',
    }
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ prospects: [prospect, second] }), { status: 200 }))
    render(<ForeclosureWorkspace />)
    const table = await screen.findByRole('table', { name: 'Foreclosure prospects' })
    expect(within(table).getByRole('link', { name: 'Open prospect' })).toHaveTextContent('—')
    expect(within(table).getByText('7125 Park Rd')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: 'Call' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sort by equity' }))
    expect(screen.getByRole('columnheader', { name: 'Equity' })).toHaveAttribute('aria-sort', 'descending')
    const owners = within(table).getAllByRole('link').filter((link) => link.className.includes('fc-owner-link')).map((link) => link.textContent)
    expect(owners[0]).toBe('—')
    expect(owners[1]).toBe('Ernest Dodson')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by sale date' }))
    expect(screen.getByRole('columnheader', { name: 'Sale date' })).toHaveAttribute('aria-sort', 'ascending')
    const saleOrder = within(table).getAllByRole('link').filter((link) => link.className.includes('fc-owner-link')).map((link) => link.textContent)
    expect(saleOrder).toEqual(['Ernest Dodson', '—'])
  })

  it('hides below-floor equity from the default New queue and formats multi-owner names', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      prospects: [
        {
          ...prospect,
          ownerName: 'HALL BENJAMIN PATRICK; HALL CHRISTINE PAIGE',
          status: 'new',
          estEquity: 90000,
          phones: [],
        },
        {
          ...prospect,
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          ownerName: 'LOW EQUITY LLC',
          status: 'new',
          estEquity: 10000,
          phones: [],
          dialReady: false,
        },
      ],
    }), { status: 200 }))
    render(<ForeclosureWorkspace />)
    const table = await screen.findByRole('table', { name: 'Foreclosure prospects' })
    expect(within(table).getByText('Owner 1 Benjamin Hall')).toBeInTheDocument()
    expect(within(table).getByText('Owner 2 Christine Hall')).toBeInTheDocument()
    expect(within(table).queryByText(/HALL BENJAMIN/)).not.toBeInTheDocument()
    expect(within(table).queryByText('Low Equity LLC')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: '' } })
    expect(await screen.findByText('Low Equity LLC')).toBeInTheDocument()
  })

  it('shows the call affordance and lead link on the detail record', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      prospect: { ...prospect, leadId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    }), { status: 200 }))
    render(<ForeclosureDetail id={prospect.id} />)
    expect(await screen.findByRole('button', { name: 'Call' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Open lead file' })).toHaveAttribute('href', '/leads/dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    expect(screen.getAllByText('$150,000').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1st notice').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }))
    expect(screen.getByText('Morgan Dodson')).toBeInTheDocument()
    expect(screen.getByText('Riley Dodson')).toBeInTheDocument()
    expect(screen.getByText('Spouse')).toBeInTheDocument()
    expect(screen.getByText('Alive')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Maps' }))
    expect(screen.getByRole('region', { name: 'Foreclosure sale map' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', expect.stringContaining('google.com/maps'))
    expect(screen.getByText(/Street View is not loaded/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.queryByText(/sorts first/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Owner is a person/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Phones can follow the equity floor/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /update timeline/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/No attorney or sale-date changes yet/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save notice file' })).not.toBeInTheDocument()
    expect(screen.queryByText(/75,000 floor/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Notice file' }))
    expect(screen.getByRole('button', { name: 'Save notice file' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(`/api/prospecting/foreclosure/${prospect.id}/call`, { method: 'POST' }))
  })

  it('shows the update timeline only after an attorney or sale-date change', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      prospect: {
        ...prospect,
        noticeTimeline: [{ at: '2026-09-20T15:00:00.000Z', field: 'attorney', from: null, to: 'Sandbox Trustee' }],
      },
    }), { status: 200 }))
    render(<ForeclosureDetail id={prospect.id} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Notice file' }))
    expect(screen.getByRole('heading', { name: /update timeline/i })).toBeInTheDocument()
    expect(screen.getByText(/Attorney set to Sandbox Trustee/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save notice file' })).toBeInTheDocument()
  })

  it('shows a readable owner and one address, and keeps raw notes and the floor lecture off the screen', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      prospect: {
        ...prospect,
        ownerName: 'HALL BENJAMIN PATRICK; HALL CHRISTINE PAIGE',
        situs: '401 N Locust St, Gardner, KS 66030, Gardner KS 66030',
        city: 'Gardner',
        state: 'KS',
        zip: '66030',
        notes: 'week1 backfill; pub_in_week=True; needs_propstream; needs_smartskip',
        dialReady: false,
        dialBlockers: ['Estimated equity is below the $75,000 floor.'],
        deceased: true,
        phones: [],
        skipPhones: [],
      },
    }), { status: 200 }))
    render(<ForeclosureDetail id={prospect.id} />)
    expect(await screen.findByText('Owner 1 Benjamin Hall')).toBeInTheDocument()
    expect(screen.getByText('Owner 2 Christine Hall')).toBeInTheDocument()
    expect(screen.getByText('401 N Locust St, Gardner, KS 66030')).toBeInTheDocument()
    expect(screen.getAllByText(/Gardner/)).toHaveLength(1)
    expect(document.querySelector('.fc-pill-dead')).toHaveTextContent('Deceased')
    expect(screen.queryByText(/week1 backfill/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(screen.queryByText(/week1 backfill/)).not.toBeInTheDocument()
    expect(screen.getByText(/not shown here/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save note' })).not.toBeInTheDocument()
    expect(screen.queryByText(/75,000 floor/)).not.toBeInTheDocument()
    expect(screen.queryByText(/HALL BENJAMIN/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save notice file' })).not.toBeInTheDocument()
  })
})
