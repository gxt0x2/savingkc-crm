/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceCallController } from './workspace-call-controller'

const queueItem = {
  leadId: 'lead-1',
  prospectId: null,
  campaignMemberId: null,
  prospect_phone_id: 'phone-1',
  phone: '+18165550123',
  heirName: 'Helen Seller',
  relation: 'daughter',
  propertyAddress: '123 Main St',
  deceasedOwnerName: 'Owner Seller',
}

const baseProps = {
  callerPlan: { mode: 'static' as const, staticCallerId: '+18163078735', rotationCallerIds: [], rotateEveryCalls: 50, redialCallerId: '' },
  dialDisplay: '(816) 555-0123',
  effectiveCallerId: '+18163078735',
  onCall: vi.fn(),
  queueItem,
  statusLabel: 'Ready',
}

describe('WorkspaceCallController', () => {
  it('uses one stable loading state while the session queue is restored', () => {
    render(<WorkspaceCallController {...baseProps} dialDisplay="" dialReady={false} loadingSessionQueue queueItem={null} />)

    expect(screen.getByRole('status', { name: 'Loading calling session' })).toHaveTextContent('Loading call controls')
    expect(screen.queryByRole('button', { name: 'Start dialing' })).not.toBeInTheDocument()
  })

  it('removes duplicate seller details and offers one explicit start action', () => {
    const onCall = vi.fn()
    render(<WorkspaceCallController {...baseProps} dialReady onCall={onCall} />)

    expect(screen.getByRole('heading', { name: 'Call outcome' })).toBeVisible()
    expect(screen.getByText('Ready to dial · 00:00')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Helen Seller' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start dialing' }))
    expect(onCall).toHaveBeenCalledOnce()
  })

  it('does not expose calling-line setup inside the compact rail', () => {
    render(<WorkspaceCallController
      {...baseProps}
      callerPlan={{ mode: 'rotation', staticCallerId: '+18163078735', rotationCallerIds: ['+18163078735', '+18165550100'], rotateEveryCalls: 25, redialCallerId: '' }}
      dialReady={false}
      statusLabel="Connecting"
    />)

    expect(screen.getByRole('button', { name: 'Connecting' })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Calling from')).not.toBeInTheDocument()
  })

  it('asks for a current-contact number before enabling the start action', () => {
    render(<WorkspaceCallController {...baseProps} dialDisplay="" dialReady={false} queueItem={null} />)

    expect(screen.getByText('Choose a number from the current contact')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ready' })).toBeDisabled()
  })

  it('never starts the first call without an explicit agent action', () => {
    const onCall = vi.fn()
    render(<WorkspaceCallController {...baseProps} dialReady onCall={onCall} />)

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/starts in/i)).not.toBeInTheDocument()
    expect(onCall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start dialing' }))
    expect(onCall).toHaveBeenCalledOnce()
  })

  it('collapses to the outcome-required state after a call', () => {
    render(<WorkspaceCallController {...baseProps} dialReady={false} dialDisplay="+18165550123" outcomeRequired />)

    const summary = screen.getByRole('region', { name: 'Current call summary' })
    expect(summary).toHaveTextContent('Call ended · outcome required')
    expect(screen.queryByRole('button', { name: 'Start dialing' })).not.toBeInTheDocument()
  })
})
