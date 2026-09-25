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
    expect(screen.getByRole('checkbox', { name: 'Sale this week' })).toBeInTheDocument()
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
    expect(within(table).getByText('(913) 717-9716')).toBeInTheDocument()
    expect(screen.queryByText(/sorts first/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Owner is a person/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Foreclosure sale map' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Ernest Dodson' })).toHaveAttribute('href', `/prospecting/foreclosure/${prospect.id}`)
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', `/prospecting/foreclosure/${prospect.id}`)
    expect(screen.getByRole('link', { name: 'Foreclosure' })).toHaveAttribute('href', '/prospecting/foreclosure')
    fireEvent.click(within(table).getByText('100 Sandbox Court'))
    expect(navigation.push).toHaveBeenCalledWith(`/prospecting/foreclosure/${prospect.id}`)
    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(expect.stringContaining('prospect_ids=')))
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
    expect(within(table).getByText('NOD')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: 'Call' })).toBeInTheDocument()
    expect(within(table).getAllByRole('button', { name: 'Call' })).toHaveLength(1)
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

  it('shows the call affordance and lead link on the detail record', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      prospect: { ...prospect, leadId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    }), { status: 200 }))
    render(<ForeclosureDetail id={prospect.id} />)
    expect(await screen.findByRole('button', { name: 'Call' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Open lead file' })).toHaveAttribute('href', '/leads/dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    expect(screen.getByText(/\$150,000/)).toBeInTheDocument()
    expect(screen.getAllByText('1st notice').length).toBeGreaterThan(0)
    expect(screen.getByText('Morgan Dodson')).toBeInTheDocument()
    expect(screen.getByText('Riley Dodson')).toBeInTheDocument()
    expect(screen.getByText('Spouse')).toBeInTheDocument()
    expect(screen.queryByText(/sorts first/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Owner is a person/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Phones can follow the equity floor/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /update timeline/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/No attorney or sale-date changes yet/)).not.toBeInTheDocument()
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
    expect(await screen.findByRole('heading', { name: /update timeline/i })).toBeInTheDocument()
    expect(screen.getByText(/Attorney set to Sandbox Trustee/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save notice file' })).toBeInTheDocument()
  })
})
