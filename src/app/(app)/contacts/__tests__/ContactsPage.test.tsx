/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ContactsPage from '../page'

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }))

vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/components/conversations/workspace-frame', () => ({
  WorkspaceFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/leads/lead-status-control', () => ({
  LeadStatusControl: () => <div>Lead status control</div>,
}))

const baseContact = {
  phone: '8165550100',
  email: null,
  source: 'manual',
  address: null,
  city: null,
  deadReason: null,
  score: 20,
  isFavorite: false,
  nextActivity: null,
  tags: [],
  lastContactAt: null,
  createdAt: '2026-08-01T12:00:00Z',
  firstOutboundAt: null,
  contactSignal: null,
  updatedAt: null,
  attentionState: 'resolved' as const,
  owner: 'Casey',
  lastMessage: null,
  lastActivityAt: null,
  primaryNextAction: null,
}

const contacts = [
  { ...baseContact, id: 'active-new', fullName: 'Active New', station: 'new' as const, classification: 'lead' as const },
  { ...baseContact, id: 'dead-record', fullName: 'Dead Record', station: 'dead' as const, classification: 'dead' as const, deadReason: 'dnc_refused' },
]

describe('ContactsPage smart-list workspace', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/contacts')
    window.localStorage.clear()
    useQueryMock.mockReturnValue({ data: { items: contacts }, isLoading: false, error: null, refetch: vi.fn(), isFetching: false })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the approved smart-list labels and active-list description', () => {
    render(<ContactsPage />)

    const navigation = screen.getByRole('navigation', { name: 'Contact smart lists' })
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent?.replace(/\d+$/, '').trim())).toEqual([
      'Hot',
      'New',
      'Leads',
      'Opportunities',
      'Appointment Set',
      'Offer Made',
      'In Closing',
      'All',
    ])
    expect(screen.getByRole('heading', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByText('Every active acquisition record, excluding contacts marked Not a lead.')).toBeInTheDocument()
    expect(screen.getAllByText('Active New')).toHaveLength(2)
    expect(screen.queryByText('Dead Record')).not.toBeInTheDocument()
  })

  it('changes the header with the smart list and keeps filters behind one compact control', () => {
    render(<ContactsPage />)

    fireEvent.click(screen.getByRole('button', { name: /^New 1$/ }))
    expect(screen.getByRole('heading', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByText('New seller inquiries awaiting qualification and first contact.')).toBeInTheDocument()
    expect(window.location.search).toBe('?list=new')

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const filters = screen.getByRole('dialog', { name: 'Contact filters' })
    expect(within(filters).getByRole('combobox', { name: 'Owner' })).toBeInTheDocument()
    expect(within(filters).getByRole('combobox', { name: 'Conversation state' })).toBeInTheDocument()

    fireEvent.change(within(filters).getByRole('combobox', { name: 'Lead status' }), { target: { value: 'not_leads' } })
    expect(screen.getByRole('heading', { name: 'Not Leads' })).toBeInTheDocument()
    expect(screen.getByText('Records removed from the active pipeline with a required disposition reason.')).toBeInTheDocument()
    expect(screen.getAllByText('Dead Record')).toHaveLength(2)
    expect(screen.queryByText('Active New')).not.toBeInTheDocument()
  })

  it('offers the three sort choices without reserving a permanent select row', () => {
    render(<ContactsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    const sortMenu = screen.getByRole('dialog', { name: 'Sort contacts' })
    expect(within(sortMenu).getByRole('button', { name: /Priority first/ })).toBeInTheDocument()
    fireEvent.click(within(sortMenu).getByRole('button', { name: 'Recently active' }))
    expect(screen.queryByRole('dialog', { name: 'Sort contacts' })).not.toBeInTheDocument()
  })
})
