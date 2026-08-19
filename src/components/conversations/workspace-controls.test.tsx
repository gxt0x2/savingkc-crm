// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposeBox } from './compose-box'
import { ContactDetailsPanel } from './contact-details-panel'
import { InboxSidebar, type ThreadPreview } from './inbox-sidebar'
import { NextActionDialog } from './next-action-dialog'
import { ThreadView } from './thread-view'

const baseThread: ThreadPreview = {
  id: 'lead-1',
  name: 'Marcus Johnson',
  initials: 'MJ',
  avatarBg: 'bg-slate-700',
  avatarText: 'text-white',
  address: '4821 Woodland Ave',
  personality: null,
  tags: [],
  lastMessage: 'I inherited a property.',
  lastChannel: 'sms',
  activityAt: '2026-08-01T15:00:00.000Z',
  timestamp: 'Today',
  unread: true,
  attentionState: 'needs_reply',
  owner: 'Ernest',
  nextAction: null,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('rebuilt conversation workspace controls', () => {
  it('closes the contact details rail through a real named button', () => {
    const onClose = vi.fn()
    render(<ContactDetailsPanel contact={{
      id: 'lead-1',
      full_name: 'Marcus Johnson',
      phone: '+18165550198',
      email: 'marcus@example.com',
      property_address: '4821 Woodland Ave',
      city: 'Kansas City',
      station: 'qualified',
      priority: 'hot',
      assigned_agent: 'Ernest',
    }} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close contact details' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('uses the signed-in agent, All, Recent, and Hot as the primary work queues', () => {
    render(<InboxSidebar
      threads={[
        { ...baseThread, hot: true },
        { ...baseThread, id: 'lead-2', name: 'Sheila Brooks', owner: 'Casey' },
      ]}
      activeThreadId="lead-1"
      onSelectThread={() => {}}
      currentUserName="Ernest"
    />)

    expect(screen.getByRole('button', { name: /Ernest 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Recent 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hot 1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Inbox/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mine/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Needs Reply \d+$/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Ernest 1/ }))
    expect(screen.getByRole('combobox', { name: 'Filter by assigned team member' })).toHaveValue('ernest')
    expect(screen.getByText('Marcus Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Sheila Brooks')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Hot 1/ }))
    expect(screen.getByRole('combobox', { name: 'Filter by assigned team member' })).toHaveValue('team')
    expect(screen.getByText('Marcus Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Sheila Brooks')).not.toBeInTheDocument()
  })

  it('opens real conversation filters with preset and custom date ranges', () => {
    render(<InboxSidebar
      threads={[
        baseThread,
        { ...baseThread, id: 'lead-2', name: 'Older Contact', activityAt: '2026-07-01T15:00:00.000Z', timestamp: 'Jul 1' },
      ]}
      activeThreadId="lead-1"
      onSelectThread={() => {}}
      currentUserName="Ernest"
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Conversation filters' }))
    const filters = screen.getByRole('dialog', { name: 'Filter conversations' })
    expect(within(filters).getByRole('combobox', { name: 'Conversation date range' })).toHaveTextContent('All timeTodayLast 7 daysLast 30 daysCustom range')
    expect(within(filters).getByRole('combobox', { name: 'Conversation reply state' })).toBeInTheDocument()
    expect(within(filters).getByRole('combobox', { name: 'Conversation next action' })).toBeInTheDocument()

    fireEvent.change(within(filters).getByRole('combobox', { name: 'Conversation date range' }), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Conversation start date'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('Conversation end date'), { target: { value: '2026-08-01' } })
    expect(screen.getByText('Marcus Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Older Contact')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conversation filters, 1 active' })).toBeInTheDocument()

    fireEvent.click(within(filters).getByRole('button', { name: 'Show results' }))
    fireEvent.click(screen.getByRole('button', { name: 'Conversation filters, 1 active' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('Older Contact')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sort conversations' }))
    const sortMenu = screen.getByRole('dialog', { name: 'Sort conversations' })
    fireEvent.click(within(sortMenu).getByRole('button', { name: 'Recent activity' }))
    expect(screen.queryByRole('dialog', { name: 'Sort conversations' })).not.toBeInTheDocument()
  })

  it('filters the team inbox by Casey, Ernest, Gertha, Team, or Unassigned', () => {
    render(<InboxSidebar
      threads={[
        baseThread,
        { ...baseThread, id: 'lead-2', name: 'Sheila Brooks', owner: 'Casey' },
        { ...baseThread, id: 'lead-3', name: 'Gertha Contact', owner: 'Gertha' },
        { ...baseThread, id: 'lead-4', name: 'Team Queue Contact', owner: null },
      ]}
      activeThreadId="lead-1"
      onSelectThread={() => {}}
      currentUserName="Ernest"
    />)

    const ownerFilter = screen.getByRole('combobox', { name: 'Filter by assigned team member' })
    expect(within(ownerFilter).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Casey', 'Ernest', 'Gertha', 'All', 'Unassigned',
    ])

    fireEvent.change(ownerFilter, { target: { value: 'casey' } })
    expect(screen.getByText('Sheila Brooks')).toBeInTheDocument()
    expect(screen.queryByText('Marcus Johnson')).not.toBeInTheDocument()

    fireEvent.change(ownerFilter, { target: { value: 'unassigned' } })
    expect(screen.getByText('Team Queue Contact')).toBeInTheDocument()
    expect(screen.queryByText('Sheila Brooks')).not.toBeInTheDocument()
  })

  it('keeps the active conversation synchronized with the visible filtered list', async () => {
    const onSelectThread = vi.fn()
    render(<InboxSidebar
      threads={[
        baseThread,
        { ...baseThread, id: 'lead-2', name: 'Sheila Brooks', owner: 'Casey' },
      ]}
      activeThreadId="lead-1"
      onSelectThread={onSelectThread}
      currentUserName="Ernest"
    />)

    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'Sheila' },
    })

    await waitFor(() => expect(onSelectThread).toHaveBeenCalledWith('lead-2'))
    expect(screen.getByText('Sheila Brooks')).toBeInTheDocument()
    expect(screen.queryByText('Marcus Johnson')).not.toBeInTheDocument()
  })

  it('opens directly in the requested communication mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ templates: [] }),
    }))

    render(<ComposeBox
      leadId="lead-1"
      phone="+18165550198"
      email="marcus@example.com"
      initialMode="email"
    />)

    await waitFor(() => expect(screen.getByRole('button', { name: /Email/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByLabelText('Email subject')).toBeInTheDocument()
  })

  it('lets the server resolve the sender for an established SMS thread', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (input === '/api/sms-templates') {
        return { ok: true, json: async () => ({ templates: [] }) }
      }
      return { ok: true, json: async () => ({ success: true, from: '+18166088559' }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ComposeBox
      leadId="lead-1"
      phone="+18165550198"
      replyFromPhone="+18166088559"
    />)

    fireEvent.change(screen.getByPlaceholderText('Type your message... (Enter to send)'), {
      target: { value: 'Reply on the established thread' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send text message' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/send',
      expect.objectContaining({ method: 'POST' }),
    ))
    const sendCall = fetchMock.mock.calls.find(([input]) => input === '/api/conversations/send')
    const payload = JSON.parse(String(sendCall?.[1]?.body))

    expect(payload.resolveSenderFromConversation).toBe(true)
    expect(payload).not.toHaveProperty('fromPhone')
  })

  it('resets a manual SMS sender when the active thread changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ templates: [] }),
    }))

    const { rerender } = render(<ComposeBox
      leadId="lead-1"
      phone="+18165550198"
    />)
    const sender = screen.getByRole('combobox', { name: 'Sending phone number' })
    fireEvent.change(sender, { target: { value: '+18166088552' } })
    expect(sender).toHaveValue('+18166088552')

    rerender(<ComposeBox
      leadId="lead-2"
      phone="+19135550123"
    />)

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Sending phone number' })).toHaveValue('+18163077835'))
  })

  it('surfaces delivered-but-not-persisted email without encouraging a resend', async () => {
    const onSent = vi.fn()
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (input === '/api/sms-templates') {
        return { ok: true, json: async () => ({ templates: [] }) }
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          sent: true,
          persisted: false,
          deliveryState: 'delivered_not_persisted',
          warning: 'Email delivered, but CRM history could not be saved. Do not resend this email.',
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ComposeBox
      leadId="lead-1"
      phone="+18165550198"
      email="marcus@example.com"
      initialMode="email"
      onSent={onSent}
    />)

    fireEvent.change(screen.getByPlaceholderText('Compose email...'), { target: { value: 'Delivered once' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }))

    const warning = await screen.findByRole('status')
    expect(warning).toHaveTextContent('Email delivered')
    expect(warning).toHaveTextContent('Do not resend')
    expect(screen.getByPlaceholderText('Compose email...')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Send email' })).toBeDisabled()
    expect(onSent).toHaveBeenCalledOnce()
  })

  it('does not send a client-authored agent identity with an internal note', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (input === '/api/sms-templates') {
        return { ok: true, json: async () => ({ templates: [] }) }
      }
      return { ok: true, json: async () => ({ success: true }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ComposeBox
      leadId="lead-1"
      phone="+18165550198"
      initialMode="note"
    />)

    fireEvent.change(screen.getByPlaceholderText('Add an internal note...'), { target: { value: 'Call after 3 PM' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add internal note' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/leads/lead-1/activities',
      expect.objectContaining({ method: 'POST' }),
    ))
    const noteCall = fetchMock.mock.calls.find(([input]) => input === '/api/leads/lead-1/activities')
    expect(JSON.parse(String(noteCall?.[1]?.body))).toEqual({ description: 'Call after 3 PM' })
  })

  it('uses the thread header for agent, team, and reply state without repeating a caller phone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ templates: [] }),
    }))

    const { container } = render(<ThreadView
      contact={{
        name: '(816) 476-4715',
        initials: '15',
        assignedAgent: null,
        team: 'Acquisitions',
        attentionState: 'needs_reply',
        owner: null,
        nextAction: null,
      }}
      dateGroups={[]}
      phone="+18164764715"
    />)

    const header = container.querySelector('header')
    expect(header).not.toBeNull()
    expect(within(header!).getByText('Agent · Unassigned')).toBeInTheDocument()
    expect(within(header!).getByText('Team · Acquisitions')).toBeInTheDocument()
    expect(within(header!).getByText('Needs Reply')).toBeInTheDocument()
    expect(header!.textContent?.match(/816/g)).toHaveLength(1)
  })

  it('separates lead source from durable decision signals', () => {
    render(<ContactDetailsPanel contact={{
      id: 'lead-ivr',
      full_name: 'Caller (816) 476-4715',
      phone: '+18164764715',
      email: null,
      property_address: null,
      city: null,
      station: 'new',
      priority: 'normal',
      assigned_agent: null,
      source: 'inbound_ivr_no_input',
      decision_tags: [{ id: 'tax_delinquent', label: 'Tax delinquent', category: 'Risk', tone: 'brand' }],
    }} />)

    expect(screen.getByText('Source: Inbound IVR')).toBeInTheDocument()
    expect(screen.getByText('Risk ·')).toBeInTheDocument()
    expect(screen.getByText('Tax delinquent')).toBeInTheDocument()
    expect(screen.queryByText(/Inbound Ivr No Input/i)).not.toBeInTheDocument()
  })

  it('assigns a conversation from the Agent control', async () => {
    const onConversationChanged = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, assignedAgent: 'Casey' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ThreadView
      contact={{
        name: 'Marcus Johnson',
        initials: 'MJ',
        assignedAgent: null,
        team: 'Acquisitions',
        attentionState: 'needs_reply',
        owner: null,
        nextAction: null,
      }}
      dateGroups={[]}
      leadId="lead-1"
      phone="+18165550198"
      onConversationChanged={onConversationChanged}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Assign agent. Current: Unassigned' }))
    expect(screen.getByRole('button', { name: 'Assign to Gertha' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Assign to Casey' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/conversations/assignment', expect.objectContaining({ method: 'PATCH' })))
    await waitFor(() => expect(onConversationChanged).toHaveBeenCalledOnce())
  })

  it('makes the next-action card a real control', () => {
    const onNextAction = vi.fn()
    render(<ContactDetailsPanel contact={{
      id: 'lead-1',
      full_name: 'Marcus Johnson',
      phone: '+18165550198',
      email: null,
      property_address: null,
      city: null,
      station: 'new',
      priority: 'normal',
      assigned_agent: 'Ernest',
    }} onNextAction={onNextAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Define the next action' }))
    expect(onNextAction).toHaveBeenCalledOnce()
  })

  it('creates a primary next action from the conversation dialog', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, taskId: 'task-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NextActionDialog
      leadId="lead-1"
      leadName="Marcus Johnson"
      action={null}
      defaultOwner="Ernest"
      onClose={onClose}
      onSaved={onSaved}
    />)

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'Call seller with offer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create action' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/calendar/tasks', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"primaryNextAction":true'),
    })))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
  })
})
