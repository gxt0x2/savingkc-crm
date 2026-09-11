/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProspectingPreviewCallRail } from './prospecting-preview-call-rail'

const props = {
  campaignId: 'campaign-1',
  callerId: '+18163100845',
  callerMode: 'static',
  rotationNumbers: '+18163100845',
}

describe('ProspectingPreviewCallRail', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => vi.useRealTimers())

  it('waits for the agent to start a read-only dialing session', () => {
    render(<ProspectingPreviewCallRail {...props} />)

    act(() => window.dispatchEvent(new CustomEvent('prospecting-preview-queue-ready', { detail: { queue: [{
      leadId: 'lead-1', prospectId: null, campaignMemberId: 'member-1', prospect_phone_id: 'phone-1', phone: '+18165550123', heirName: 'Helen Seller', relation: 'daughter', propertyAddress: '123 Main St', deceasedOwnerName: 'Owner Seller',
    }] } })))

    expect(screen.getByText('Call outcome')).toBeVisible()
    expect(screen.getByText('Preview only')).toBeVisible()
    expect(screen.getByText('Ready to dial · 00:00')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start dialing' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Contact' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'No Contact' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Bad Number' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Voicemail' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'DNC Contact' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'DNC Number' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Contact' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redial' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Hang up' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible()
    const stop = screen.getByRole('button', { name: 'Stop' })
    expect(stop).toBeVisible()
    expect(stop.querySelector('.material-symbols-outlined')).toBeNull()
  })

  it('lets reviewers exercise pause, resume, disposition, and redial without writes', async () => {
    render(<ProspectingPreviewCallRail {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start dialing' }))
    expect(screen.getByText('Connected · 00:00')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(screen.getByText('Paused · 00:00')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByText('Connected · 00:00')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'No Contact' }))
    expect(screen.getByText('Call ended · 00:00')).toBeVisible()
    expect(screen.getByRole('button', { name: 'No Contact' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Redial' }))
    expect(screen.getByText('Connected · 00:00')).toBeVisible()
  })
})
