// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { email: 'casey@savingkc.com' }, loading: false }) }))

import { ProspectingWrapUpActions } from './prospecting-wrap-up-actions'

const baseProps = {
  leadId: null,
  prospectId: 'prospect-1',
  campaignMemberId: 'member-1',
  dialerSessionId: '',
  sellerName: 'Mojo Contact',
  propertyAddress: '123 Main St',
  activities: [],
  readOnly: false,
  onRefresh: vi.fn(),
}

describe('ProspectingWrapUpActions', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('opens a source-Prospect follow-up without requiring promotion', async () => {
    render(<ProspectingWrapUpActions {...baseProps} />)

    expect(screen.getByText('Source Prospect')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /follow-up/i }))
    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.getByText('Attached to source Prospect:')).toBeVisible()
    expect(screen.getByLabelText('Title')).toHaveValue('Follow up with Mojo Contact')
  })

  it('locks CRM mutations in read-only preview', () => {
    render(<ProspectingWrapUpActions {...baseProps} readOnly />)

    expect(screen.getByRole('button', { name: /follow-up/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /appointment/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /mail/i })).toBeDisabled()
    expect(screen.getByText(/locked until this window owns/i)).toBeVisible()
  })

  it('completes the selected pending mail record and refreshes its persisted status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mailAction: { status: 'completed' } }) })
    vi.stubGlobal('fetch', fetchMock)
    const onRefresh = vi.fn()
    render(<ProspectingWrapUpActions {...baseProps} onRefresh={onRefresh} activities={[{
      id: 'mail-1', activity_type: 'mail', description: 'Thank-you letter', agent: 'Casey', created_at: '2026-09-10T15:00:00Z',
      metadata: { title: 'Thank-you letter', status: 'pending', mail_piece_type: 'thank_you' },
    }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark sent: Thank-you letter' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ workItemKey: 'activity:mail-1', prospectId: 'prospect-1', mailState: 'sent' })
    expect(screen.getByText('Mail marked sent.')).toBeVisible()
  })

  it('keeps needed and already-sent choices tied to the same source Prospect', async () => {
    render(<ProspectingWrapUpActions {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /^mail$/i }))
    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Needs mailing' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Already sent' }))
    expect(screen.getByRole('button', { name: 'Mark Sent' })).toBeVisible()
    expect(screen.queryByLabelText('Mail by')).not.toBeInTheDocument()
  })
})
