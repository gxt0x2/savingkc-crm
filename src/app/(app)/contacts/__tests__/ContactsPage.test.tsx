/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ContactsPage from '../page'
import { CONTACT_SMART_LIST_ORDER_STORAGE_KEY } from '@/lib/contact-smart-lists'

const { useQueryMock, useQueryClientMock, pushMock } = vi.hoisted(() => ({ useQueryMock: vi.fn(), useQueryClientMock: vi.fn(), pushMock: vi.fn() }))

vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock, useQueryClient: useQueryClientMock }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { email: 'ernest@savingkc.com' } }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/components/conversations/workspace-frame', () => ({
  WorkspaceChrome: ({ commandBar }: { commandBar?: React.ReactNode }) => <header data-testid="shared-shell-header">{commandBar}</header>,
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
  outreachStatus: 'unattempted' as const,
  updatedAt: null,
  attentionState: 'resolved' as const,
  owner: 'Casey',
  lastMessage: null,
  lastActivityAt: null,
  primaryNextAction: null,
}

const contacts = [
  { ...baseContact, id: 'new-intake', fullName: 'New Intake', station: 'new' as const, classification: null, address: '6509 W 74TH ST', city: 'Overland Park', attentionState: 'needs_reply' as const },
  { ...baseContact, id: 'active-lead', fullName: 'Active Lead', station: 'contacted' as const, classification: 'lead' as const, address: '6509 W 74TH ST', city: 'Overland Park', attentionState: 'needs_reply' as const },
  { ...baseContact, id: 'dead-record', fullName: 'Dead Record', station: 'dead' as const, classification: 'dead' as const, deadReason: 'dnc_refused' },
]

describe('ContactsPage smart-list workspace', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/contacts')
    window.localStorage.clear()
    useQueryClientMock.mockReturnValue({ fetchQuery: vi.fn(), invalidateQueries: vi.fn(), setQueryData: vi.fn() })
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      const scope = queryKey?.[1]
      const scopedContacts = scope === 'active'
        ? contacts.filter((contact) => contact.station !== 'dead')
        : scope === 'not_leads'
          ? contacts.filter((contact) => contact.station === 'dead')
          : contacts
      return { data: { items: scopedContacts }, isLoading: false, error: null, refetch: vi.fn(), isFetching: false }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the approved smart-list labels and active-list description', () => {
    render(<ContactsPage />)

    const navigation = screen.getByRole('navigation', { name: 'Pipeline smart lists' })
    const smartListButtons = within(navigation).getAllByRole('button').filter((button) => !button.getAttribute('aria-label')?.startsWith('Reorder '))
    expect(smartListButtons.map((button) => button.textContent?.replace(/\d+$/, '').trim())).toEqual([
      'Leads',
      'Opportunities',
      'Appointment Set',
      'Offer Made',
      'In Closing',
      'All',
    ])
    expect(screen.getByRole('heading', { name: 'Leads' })).toBeInTheDocument()
    expect(screen.getByText('Seller records an agent explicitly confirmed as leads.')).toBeInTheDocument()
    expect(screen.getAllByText('Active Lead')).toHaveLength(2)
    expect(screen.queryByText('New Intake')).not.toBeInTheDocument()
    expect(screen.queryByText('Dead Record')).not.toBeInTheDocument()
  })

  it('places context, search, and actions together in the requested header order', () => {
    render(<ContactsPage />)

    const header = screen.getByTestId('contacts-command-header')
    expect(screen.getByTestId('shared-shell-header')).toContainElement(header)
    expect(Array.from(header.querySelectorAll('[data-header-slot]')).map((element) => element.getAttribute('data-header-slot'))).toEqual([
      'context',
      'search',
      'actions',
    ])
    expect(within(header).getByRole('textbox', { name: 'Search contacts' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: /Import/ })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: /Add contact/ })).toBeInTheDocument()
  })

  it('restores a customized smart-list order using the whole tab as the drag target', () => {
    window.localStorage.setItem(CONTACT_SMART_LIST_ORDER_STORAGE_KEY, JSON.stringify(['all', 'new']))
    render(<ContactsPage />)

    const navigation = screen.getByRole('navigation', { name: 'Pipeline smart lists' })
    const smartListButtons = within(navigation).getAllByRole('button').filter((button) => !button.getAttribute('aria-label')?.startsWith('Reorder '))
    expect(smartListButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'All 1',
      'Leads 1',
      'Opportunities 0',
      'Appointment Set 0',
      'Offer Made 0',
      'In Closing 0',
    ])
    expect(within(navigation).queryByRole('button', { name: /Reorder .* smart list/ })).not.toBeInTheDocument()
    expect(navigation.querySelector('[data-icon="drag_indicator"]')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset smart-list order' }))
    expect(within(navigation).getAllByRole('button').filter((button) => !button.getAttribute('aria-label')?.startsWith('Reorder ')).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Leads 1',
      'Opportunities 0',
      'Appointment Set 0',
      'Offer Made 0',
      'In Closing 0',
      'All 1',
    ])
    expect(screen.queryByRole('button', { name: 'Reset smart-list order' })).not.toBeInTheDocument()
  })

  it('changes the header with the smart list and keeps filters behind one compact control', () => {
    render(<ContactsPage />)

    fireEvent.click(screen.getByRole('button', { name: /^Leads 1$/ }))
    expect(screen.getByRole('heading', { name: 'Leads' })).toBeInTheDocument()
    expect(screen.getByText('Seller records an agent explicitly confirmed as leads.')).toBeInTheDocument()
    expect(window.location.search).toBe('?list=contacted')
    expect(screen.queryByRole('button', { name: 'Clear ×' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const filters = screen.getByRole('dialog', { name: 'Contact filters' })
    expect(within(filters).getByRole('combobox', { name: 'Owner' })).toBeInTheDocument()
    expect(within(filters).getByRole('combobox', { name: 'Conversation state' })).toBeInTheDocument()

    fireEvent.change(within(filters).getByRole('combobox', { name: 'Lead status' }), { target: { value: 'not_leads' } })
    expect(screen.getByRole('heading', { name: 'Not Leads' })).toBeInTheDocument()
    expect(screen.getByText('Records removed from the active pipeline with a required disposition reason.')).toBeInTheDocument()
    expect(screen.getAllByText('Dead Record')).toHaveLength(2)
    expect(screen.queryByText('New Intake')).not.toBeInTheDocument()
  })

  it('offers the three sort choices without reserving a permanent select row', () => {
    render(<ContactsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    const sortMenu = screen.getByRole('dialog', { name: 'Sort contacts' })
    expect(within(sortMenu).getByRole('button', { name: /Priority first/ })).toBeInTheDocument()
    fireEvent.click(within(sortMenu).getByRole('button', { name: 'Recently active' }))
    expect(screen.queryByRole('dialog', { name: 'Sort contacts' })).not.toBeInTheDocument()
  })

  it('shows the city once and uses the SavingKC brand for needs-reply row attention', () => {
    render(<ContactsPage />)

    const contactName = screen.getByRole('button', { name: /Active Lead/ })
    const contactRow = contactName.closest('.grid')
    expect(contactRow).toBeTruthy()
    expect(contactRow?.textContent?.match(/Overland Park/g)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close contact details' }))
    expect(contactRow).toHaveClass('border-l-[var(--crm-brand)]')
    expect(contactRow).not.toHaveClass('border-l-[var(--crm-warning)]')
  })

  it('supports bulk selection and opens the full lead workspace on double-click', () => {
    render(<ContactsPage />)

    const contactName = screen.getByRole('button', { name: /Active Lead/ })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Active Lead' }))
    expect(screen.getByRole('region', { name: 'Bulk contact changes' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Bulk action' })).toBeInTheDocument()

    fireEvent.doubleClick(contactName)
    expect(pushMock).toHaveBeenCalledWith('/leads/active-lead')
  })

  it('labels the workspace Pipeline and exposes safe bulk classifications', () => {
    render(<ContactsPage />)

    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Active Lead' }))
    expect(within(screen.getByRole('combobox', { name: 'Bulk action' })).getByRole('option', { name: 'Add to Leads' })).toHaveValue('classify:lead')
    expect(within(screen.getByRole('combobox', { name: 'Bulk action' })).getByRole('option', { name: 'Remove from Pipeline' })).toHaveValue('classify:new')
  })

  it('never shows an unclassified prospecting contact in All Pipeline records', () => {
    render(<ContactsPage />)

    fireEvent.click(screen.getByRole('button', { name: /^All 1$/ }))
    expect(screen.queryByText('New Intake')).not.toBeInTheDocument()
    expect(screen.getAllByText('Active Lead')).toHaveLength(2)
  })
})
