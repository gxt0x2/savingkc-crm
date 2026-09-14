// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

  it('does not repeat the current-record attachment message inside action tabs', () => {
    render(<ProspectingWrapUpActions {...baseProps} variant="tab" action="follow_up" />)

    expect(screen.queryByText(/Attached to the current record/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add follow-up/i })).toBeVisible()
  })
})
