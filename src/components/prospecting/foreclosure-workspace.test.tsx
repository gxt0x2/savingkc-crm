/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    expect(screen.getByRole('link', { name: 'Foreclosure' })).toHaveAttribute('href', '/prospecting/foreclosure')
    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(expect.stringContaining('prospect_ids=')))
  })

  it('shows the call affordance and lead link on the detail record', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      prospect: { ...prospect, leadId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    }), { status: 200 }))
    render(<ForeclosureDetail id={prospect.id} />)
    expect(await screen.findByRole('button', { name: 'Call' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Open lead file' })).toHaveAttribute('href', '/leads/dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    expect(screen.getByText(/\$150,000/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(`/api/prospecting/foreclosure/${prospect.id}/call`, { method: 'POST' }))
  })
})
