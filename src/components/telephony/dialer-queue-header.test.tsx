/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DialerQueueHeader } from './dialer-queue-header'

const item = {
  leadId: 'lead-1',
  prospectId: null,
  campaignMemberId: 'member-1',
  prospect_phone_id: 'phone-1',
  phone: '+18165550123',
  heirName: 'Helen Seller',
  relation: 'daughter',
  propertyAddress: '123 Main St',
  deceasedOwnerName: 'Owner Seller',
}

describe('DialerQueueHeader', () => {
  it('reduces the prospecting workspace header to number progress only', () => {
    render(<DialerQueueHeader item={item} index={1} length={4} callBusy={false} workspace onEnd={vi.fn()} onPrevious={vi.fn()} onSkip={vi.fn()} />)

    expect(screen.getByLabelText('Number progress')).toHaveTextContent('2 of 4')
    expect(screen.queryByText('Helen Seller')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Previous heir')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Skip without logging')).not.toBeInTheDocument()
  })

  it('preserves manual queue navigation in the standalone dialer', () => {
    render(<DialerQueueHeader item={item} index={0} length={4} callBusy={false} workspace={false} onEnd={vi.fn()} onPrevious={vi.fn()} onSkip={vi.fn()} />)

    expect(screen.getByText('Helen Seller', { exact: false })).toBeVisible()
    expect(screen.getByTitle('Previous heir')).toBeDisabled()
    expect(screen.getByTitle('Skip without logging')).toBeVisible()
  })
})
