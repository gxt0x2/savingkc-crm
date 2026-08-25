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

    expect(screen.getByText(/Helen Seller/)).toBeVisible()
    expect(screen.getByText('(816) 555-0123')).toBeVisible()
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
        queueItem={null}
        statusLabel="Connecting"
      />,
    )

    expect(screen.getByText('Automatic rotation · 2 approved lines · changes every 25 calls')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Connecting' })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
