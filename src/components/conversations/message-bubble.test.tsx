// @vitest-environment jsdom

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageBubble } from './message-bubble'

describe('conversation call card', () => {
  it('shows direction, parties, routing, and outcome instead of a raw IVR sentence', () => {
    render(<MessageBubble message={{
      id: 'call-1',
      type: 'call',
      direction: 'received',
      content: 'Inbound call from +14195585125 — no IVR input, routing to agents',
      timestamp: '9:25 AM',
      senderInitials: '25',
      callOutcome: { key: 'routing', label: 'Routing to Acquisitions', icon: 'groups', tone: 'attention' },
      fromPhone: '(419) 558-5125',
      toPhone: '(816) 307-7835',
      routingTeam: 'Acquisitions',
    }} />)

    expect(screen.getByText('Routing to Acquisitions')).toBeInTheDocument()
    expect(screen.getByText('Team · Acquisitions')).toBeInTheDocument()
    expect(screen.getByText('(419) 558-5125')).toBeInTheDocument()
    expect(screen.getByText('(816) 307-7835')).toBeInTheDocument()
    expect(screen.queryByText(/no IVR input, routing to agents/i)).not.toBeInTheDocument()
  })

  it('names a missed-call outcome instead of relying on a generic phone icon', () => {
    render(<MessageBubble message={{
      id: 'call-2',
      type: 'call',
      direction: 'received',
      content: 'Inbound call',
      timestamp: '10:15 AM',
      senderInitials: '15',
      callOutcome: { key: 'no_answer', label: 'No answer', icon: 'phone_missed', tone: 'negative' },
      fromPhone: '(816) 555-0115',
      toPhone: '(816) 307-7835',
    }} />)

    expect(screen.getByText('No answer')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('typed conversation timeline', () => {
  it('renders an internal note as a note instead of a sent text', () => {
    render(<MessageBubble message={{
      id: 'note-1',
      type: 'note',
      direction: 'sent',
      content: 'Seller asked us to call after 3 PM.',
      timestamp: '11:15 AM',
      senderInitials: 'ED',
      agentName: 'Ernest',
    }} />)

    expect(screen.getByRole('article', { name: 'Internal note' })).toHaveTextContent('Seller asked us to call after 3 PM.')
    expect(screen.getByRole('article', { name: 'Internal note' })).toHaveTextContent('Ernest')
    expect(screen.queryByText(/Sent by/)).not.toBeInTheDocument()
  })

  it('renders task ownership, status, and due time as task facts', () => {
    render(<MessageBubble message={{
      id: 'task-1',
      type: 'task',
      direction: 'sent',
      content: 'Return seller call',
      timestamp: '11:20 AM',
      senderInitials: 'ED',
      owner: 'Casey',
      taskStatus: 'pending',
      dueAt: '2026-08-20T20:00:00.000Z',
    }} />)

    const task = screen.getByRole('article', { name: 'Task activity' })
    expect(task).toHaveTextContent('Return seller call')
    expect(task).toHaveTextContent('Owner: Casey')
    expect(task).toHaveTextContent('pending')
  })

  it('renders state changes as neutral audit events', () => {
    render(<MessageBubble message={{
      id: 'status-1',
      type: 'status',
      direction: 'sent',
      content: 'Conversation assigned to Casey',
      timestamp: '11:25 AM',
      senderInitials: 'ED',
      agentName: 'Ernest',
    }} />)

    expect(screen.getByRole('note', { name: 'Conversation status change' })).toHaveTextContent('Conversation assigned to Casey')
  })
})
