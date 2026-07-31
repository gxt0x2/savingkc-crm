// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposeBox } from './compose-box'
import { ContactDetailsPanel } from './contact-details-panel'
import { InboxSidebar, type ThreadPreview } from './inbox-sidebar'
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

  it('treats Mine as the signed-in operator instead of every assigned conversation', () => {
    render(<InboxSidebar
      threads={[
        baseThread,
        { ...baseThread, id: 'lead-2', name: 'Sheila Brooks', owner: 'Casey' },
      ]}
      activeThreadId="lead-1"
      onSelectThread={() => {}}
      currentUserName="Ernest"
    />)

    fireEvent.click(screen.getByRole('button', { name: /Mine 1/ }))
    expect(screen.getByText('Marcus Johnson')).toBeInTheDocument()
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
    expect(within(header!).getByText('Needs reply')).toBeInTheDocument()
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
})
