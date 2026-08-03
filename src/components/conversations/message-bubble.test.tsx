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
