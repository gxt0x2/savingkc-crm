// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposeBox } from './compose-box'
import { ContactDetailsPanel } from './contact-details-panel'
import { InboxSidebar, type ThreadPreview } from './inbox-sidebar'

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
})
