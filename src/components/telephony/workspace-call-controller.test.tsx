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

describe('WorkspaceCallController', () => {
  it('uses one stable loading state while the session queue is restored', () => {
    render(
      <WorkspaceCallController
        callerPlan={{ mode: 'static', staticCallerId: '+18163078735', rotationCallerIds: [], rotateEveryCalls: 50, redialCallerId: '' }}
        dialDisplay=""
        dialReady={false}
        effectiveCallerId="+18163078735"
        loadingSessionQueue
        onCall={vi.fn()}
        queueItem={null}
        statusLabel="Connecting"
      />,
    )

    expect(screen.getByRole('status', { name: 'Loading calling session' })).toHaveTextContent('Loading call controls')
    expect(screen.queryByText('Choose a number from the seller list')).not.toBeInTheDocument()
  })

  it('offers one explicit call action for the selected associated number', () => {
    const onCall = vi.fn()
    render(
      <WorkspaceCallController
        callerPlan={{ mode: 'static', staticCallerId: '+18163078735', rotationCallerIds: [], rotateEveryCalls: 50, redialCallerId: '' }}
        dialDisplay="(816) 555-0123"
        dialReady
        effectiveCallerId="+18163078735"
        onCall={onCall}
        queueItem={queueItem}
        statusLabel="Ready"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Helen Seller' })).toBeVisible()
    expect(screen.getByText('(816) 555-0123')).toBeVisible()
    expect(screen.getByText('Calling from')).toBeVisible()
    expect(screen.getByText('Campaign')).toBeVisible()
    expect(screen.queryByText(/verified by the server before every call/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Call selected number' }))
    expect(onCall).toHaveBeenCalledOnce()
  })

  it('shows rotation as server-owned policy instead of an agent setup form', () => {
    render(
      <WorkspaceCallController
        callerPlan={{ mode: 'rotation', staticCallerId: '+18163078735', rotationCallerIds: ['+18163078735', '+18165550100'], rotateEveryCalls: 25, redialCallerId: '' }}
        dialDisplay=""
        dialReady={false}
        effectiveCallerId="+18163078735"
        onCall={vi.fn()}
        queueItem={queueItem}
        statusLabel="Connecting"
      />,
    )

    expect(screen.getByText('2 lines')).toBeVisible()
    expect(screen.queryByText('2 approved lines · rotates every 25 calls')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connecting' })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('does not mislabel the agent default line as the campaign line before seller selection', () => {
    render(
      <WorkspaceCallController
        callerPlan={{ mode: 'static', staticCallerId: '+18166088588', rotationCallerIds: [], rotateEveryCalls: 50, redialCallerId: '' }}
        dialDisplay=""
        dialReady={false}
        effectiveCallerId="+18166088588"
        onCall={vi.fn()}
        queueItem={null}
        statusLabel="Ready"
      />,
    )

    expect(screen.getByText('Select a seller number')).toBeVisible()
    expect(screen.queryByText(/reviewed campaign caller ID loads/i)).not.toBeInTheDocument()
    expect(screen.queryByText('(816) 608-8588')).not.toBeInTheDocument()
    expect(screen.queryByText('Campaign-assigned line · verified by the server before every call')).not.toBeInTheDocument()
  })

  it('shows a visible first-call countdown without duplicating the persistent pause action', () => {
    render(
      <WorkspaceCallController
        autoStartCountdownSeconds={15}
        callerPlan={{ mode: 'static', staticCallerId: '+18163078735', rotationCallerIds: [], rotateEveryCalls: 50, redialCallerId: '' }}
        dialDisplay="(816) 555-0123"
        dialReady={false}
        effectiveCallerId="+18163078735"
        onCall={vi.fn()}
        queueItem={queueItem}
        statusLabel="Ready"
      />,
    )

    expect(screen.getByRole('region', { name: 'First call countdown' })).toBeVisible()
    expect(screen.getByText('First call starts in')).toBeVisible()
    expect(screen.getByText('15')).toBeVisible()
    expect(screen.getByText('Helen Seller')).toBeVisible()
    expect(screen.getByText('(816) 555-0123')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Call selected number' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pause/ })).not.toBeInTheDocument()
    expect(screen.getByText('Pause session below to stop the countdown.')).toBeVisible()
  })
})
