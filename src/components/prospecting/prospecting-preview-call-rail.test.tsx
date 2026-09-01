/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProspectingPreviewCallRail } from './prospecting-preview-call-rail'

const push = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const props = {
  campaignId: 'campaign-1',
  callerId: '+18163100845',
  callerMode: 'static',
  rotationNumbers: '+18163100845',
}

describe('ProspectingPreviewCallRail', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    push.mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('shows the persistent safe controls and counts down without placing a call', async () => {
    render(<ProspectingPreviewCallRail {...props} />)

    act(() => window.dispatchEvent(new CustomEvent('prospecting-preview-queue-ready', { detail: { queue: [{
      leadId: 'lead-1', prospectId: null, campaignMemberId: 'member-1', prospect_phone_id: 'phone-1', phone: '+18165550123', heirName: 'Helen Seller', relation: 'daughter', propertyAddress: '123 Main St', deceasedOwnerName: 'Owner Seller',
    }] } })))

    expect(screen.getByRole('region', { name: 'First call countdown' })).toHaveTextContent('15')
    expect(screen.getByText('Helen Seller')).toBeVisible()
    expect(screen.getByText('(816) 555-0123')).toBeVisible()
    expect(screen.getByText('Call outcome')).toBeVisible()
    expect(screen.queryByText(/This rail mirrors the production workflow/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Session policy')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause session' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skip seller' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'End session' })).toBeDisabled()

    for (let second = 0; second < 15; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    }
    expect(screen.getByRole('region', { name: 'Current call summary' })).toHaveTextContent('Outcome required')
    expect(screen.getByText('Call outcome').closest('details')).toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Disconnected' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Restart preview' })).toBeVisible()
  })

  it('pauses immediately and ends back at the selected campaign', async () => {
    render(<ProspectingPreviewCallRail {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause countdown preview' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.getByRole('region', { name: 'First call countdown' })).toHaveTextContent('15')
    expect(screen.getByRole('button', { name: 'Resume countdown' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'End preview' }))
    expect(push).toHaveBeenCalledWith('/prospecting?campaign=campaign-1')
  })
})
