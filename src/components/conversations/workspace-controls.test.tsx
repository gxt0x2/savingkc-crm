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
  threadKey: 'lead:lead-1',
  name: 'Marcus Johnson',
  initials: 'MJ',
  avatarBg: 'bg-slate-700',
  avatarText: 'text-white',
  address: '4821 Woodland Ave',
  lastMessage: 'I inherited a property.',
  lastChannel: 'sms',
  activityAt: '2026-08-01T15:00:00.000Z',
  timestamp: 'Today',
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

  it('uses the four server-owned work queues', () => {
    const onQueueChange = vi.fn()
    render(<InboxSidebar
      threads={[baseThread]}
      activeThreadKey="lead:lead-1"
      activeQueue="needs_reply"
      search=""
      onSelectThread={() => {}}
      onQueueChange={onQueueChange}
      onSearchChange={() => {}}
    />)

    expect(screen.getByRole('button', { name: 'Needs Reply' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Mine' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unassigned' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Recent/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hot/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mine' }))
    expect(onQueueChange).toHaveBeenCalledWith('mine')
  })

  it('switches between indexed known and unmatched contact lanes', () => {
    const onKindFilterChange = vi.fn()
    render(<InboxSidebar
      threads={[baseThread]}
      activeThreadKey="lead:lead-1"
      activeQueue="needs_reply"
      kindFilter="known"
      search=""
      onSelectThread={() => {}}
      onQueueChange={() => {}}
      onKindFilterChange={onKindFilterChange}
      onSearchChange={() => {}}
    />)

    expect(screen.getByRole('button', { name: 'Known' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Unmatched' }))
    expect(onKindFilterChange).toHaveBeenCalledWith('unmatched')
  })

  it('shows explicit empty and error states without disguising them as data', () => {
    const { rerender } = render(<InboxSidebar
      threads={[]}
      activeThreadKey=""
      activeQueue="unassigned"
      search=""
      onSelectThread={() => {}}
      onQueueChange={() => {}}
      onSearchChange={() => {}}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('No conversations are waiting for an owner.')
    expect(screen.getByRole('status')).toHaveTextContent('calculated by the CRM')

    rerender(<InboxSidebar
      threads={[]}
      activeThreadKey=""
      activeQueue="all"
      search=""
      error="Read model unavailable"
      onSelectThread={() => {}}
      onQueueChange={() => {}}
      onSearchChange={() => {}}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent('Conversations could not be loaded')
    expect(screen.getByRole('alert')).toHaveTextContent('Read model unavailable')
  })

  it('requests server search and bounded pagination instead of filtering a partial page', () => {
    const onSearchChange = vi.fn()
    const onLoadMore = vi.fn()
    render(<InboxSidebar
      threads={[baseThread]}
      activeThreadKey="lead:lead-1"
      activeQueue="all"
      search=""
      hasMore
      onSelectThread={() => {}}
      onQueueChange={() => {}}
      onSearchChange={onSearchChange}
      onLoadMore={onLoadMore}
    />)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search conversations' }), { target: { value: 'Woodland' } })
    expect(onSearchChange).toHaveBeenCalledWith('Woodland')
    fireEvent.click(screen.getByRole('button', { name: 'Load more conversations' }))
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('selects the authoritative thread key', () => {
    const onSelectThread = vi.fn()
    render(<InboxSidebar
      threads={[baseThread]}
      activeThreadKey=""
      activeQueue="all"
      search=""
      onSelectThread={onSelectThread}
      onQueueChange={() => {}}
      onSearchChange={() => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Open conversation with Marcus Johnson' }))
    expect(onSelectThread).toHaveBeenCalledWith('lead:lead-1')
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

  it('fills a quick reply with the selected seller and authenticated agent without sending it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        actorName: 'Ernest Dodson',
        templates: [{ id: 'template-1', name: 'seller_follow_up', category: 'follow_up', body: 'Hi {firstName}, this is {agentName} about {propertyAddress}.', merge_fields: ['firstName', 'agentName', 'propertyAddress'] }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ComposeBox leadId="lead-1" phone="+18165550198" fullName="Marcus Johnson" propertyAddress="4821 Woodland Ave" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sms-templates', expect.anything()))
    fireEvent.click(screen.getByRole('button', { name: 'Open message templates' }))
    fireEvent.click(await screen.findByRole('button', { name: /Seller Follow Up/ }))

    expect(screen.getByLabelText('Text message')).toHaveValue('Hi Marcus, this is Ernest Dodson about 4821 Woodland Ave.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
      threadKey="unmatched:+18164764715"
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

  it('shows the factual lead source without unsupported decision-signal chrome', () => {
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
    }} />)

    expect(screen.getByText('Source: Inbound IVR')).toBeInTheDocument()
    expect(screen.queryByText('Decision signals')).not.toBeInTheDocument()
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
      threadKey="lead:lead-1"
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

  it('updates conversation state with the authoritative thread key', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (input === '/api/sms-templates') {
        return { ok: true, json: async () => ({ templates: [] }) }
      }
      return { ok: true, json: async () => ({ success: true }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ThreadView
      threadKey="unmatched:+18164764715"
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

    fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }))
    expect(screen.getByRole('alertdialog', { name: 'Why is this conversation resolved?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Wrong number' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mark resolved' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/conversations/thread-state', expect.objectContaining({ method: 'POST' })))
    const stateCall = fetchMock.mock.calls.find(([input]) => input === '/api/conversations/thread-state')
    const payload = JSON.parse(String(stateCall?.[1]?.body))
    expect(payload).toMatchObject({
      action: 'mark_read',
      threadKey: 'unmatched:+18164764715',
      phone: '+18164764715',
      resolutionReason: 'wrong_number',
    })
    expect(payload).not.toHaveProperty('agent')
  })

  it('exposes mobile back, attention, ownership, and next-action controls', async () => {
    const onBack = vi.fn()
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (input === '/api/sms-templates') {
        return { ok: true, json: async () => ({ templates: [] }) }
      }
      return { ok: true, json: async () => ({ success: true }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ThreadView
      threadKey="lead:lead-1"
      contact={{
        name: 'Marcus Johnson',
        initials: 'MJ',
        assignedAgent: null,
        team: 'Acquisitions',
        attentionState: 'needs_reply',
        owner: null,
        nextAction: { id: 'task-1', title: 'Call with offer', dueAt: null, owner: null, overdue: false },
      }}
      dateGroups={[]}
      leadId="lead-1"
      phone="+18165550198"
      onBack={onBack}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation inbox' }))
    expect(onBack).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }))
    expect(screen.getByRole('button', { name: 'Mark resolved' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign to Casey' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Complete next action' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leads/tasks/task-1', expect.objectContaining({ method: 'PATCH' })))
  })

  it('keeps mutation errors visible on a resolved thread with no next action', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (input === '/api/sms-templates') {
        return { ok: true, json: async () => ({ templates: [] }) }
      }
      return { ok: false, json: async () => ({ error: 'Thread update failed' }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ThreadView
      threadKey="lead:lead-1"
      contact={{
        name: 'Marcus Johnson',
        initials: 'MJ',
        assignedAgent: 'Ernest',
        team: 'Acquisitions',
        attentionState: 'resolved',
        owner: 'Ernest',
        nextAction: null,
      }}
      dateGroups={[]}
      leadId="lead-1"
      phone="+18165550198"
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark needs reply' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Thread update failed')
  })

  it('does not relabel a resolved thread as waiting when a next action remains', () => {
    render(<ThreadView
      threadKey="lead:lead-1"
      contact={{
        name: 'Marcus Johnson',
        initials: 'MJ',
        assignedAgent: 'Ernest',
        team: 'Acquisitions',
        attentionState: 'resolved',
        owner: 'Ernest',
        nextAction: { id: 'task-1', title: 'Review offer', dueAt: null, owner: 'Ernest', overdue: false },
      }}
      dateGroups={[]}
      leadId="lead-1"
    />)

    expect(screen.getAllByText('Resolved').length).toBeGreaterThan(0)
    expect(screen.queryByText('Waiting on contact')).not.toBeInTheDocument()
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
