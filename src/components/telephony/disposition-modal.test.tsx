// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DispositionModal } from './disposition-modal'
import { PROSPECTING_DIALER_DISPOSITIONS } from '@/lib/dialer-dispositions'

function renderModal(props: Partial<React.ComponentProps<typeof DispositionModal>> = {}) {
  return renderToStaticMarkup(
    <DispositionModal
      open
      onClose={() => {}}
      onDisposition={() => true}
      leadName="Jill Woods"
      phoneNumber="+18169169564"
      {...props}
    />,
  )
}

describe('DispositionModal', () => {
  it('keeps the main phone focused on call results rather than seller qualification', () => {
    const html = renderModal()

    expect(html).toContain('grid grid-cols-2 xl:grid-cols-3')
    expect(html).toContain('Connected')
    expect(html).toContain('Callback')
    expect(html).toContain('Appointment Set')
    expect(html).toContain('No Answer')
    expect(html).toContain('Left Voicemail')
    expect(html).not.toContain('Interested')
    expect(html).not.toContain('Offer Made')
    expect(html).not.toContain('Dead Lead')
    expect(html).toContain('Save &amp; Next Lead')
  })

  it('uses the distinct seller-qualification outcomes in Prospecting', () => {
    const html = renderModal({
      variant: 'prospecting',
      dispositions: PROSPECTING_DIALER_DISPOSITIONS,
      markAsLeadAvailable: true,
      markAsLeadLabel: 'Mark Angela Taylor as lead',
      showVerifyToggle: true,
      verifyLabel: 'Verified — this is Angela Taylor',
      primaryActionLabel: 'Save & Next Number',
    })

    expect(html).toContain('grid grid-cols-2 xl:grid-cols-3')
    expect(html).toContain('Mark Angela Taylor as lead')
    expect(html).toContain('Verified — this is Angela Taylor')
    expect(html).toContain('Reached Person')
    expect(html).toContain('Interested')
    expect(html).toContain('Dead Lead')
    expect(html).not.toContain('Offer Made')
    expect(html).not.toContain('Save &amp; Next Number')
    expect(html).not.toContain('Save &amp; Close')
  })

  it('saves the outcome before opening a next action', async () => {
    const onDisposition = vi.fn().mockResolvedValue(true)
    const onNextActionPick = vi.fn()
    const onClose = vi.fn()

    render(
      <DispositionModal
        open
        onClose={onClose}
        onDisposition={onDisposition}
        leadName="Jill Woods"
        nextActions={[{ id: 'set_next_activity', label: 'Set Next Activity', icon: 'event_note' }]}
        onNextActionPick={onNextActionPick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Set Next Activity' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose and save the call outcome')
    expect(onNextActionPick).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /No Answer/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Set Next Activity' }))

    await waitFor(() => expect(onDisposition).toHaveBeenCalledWith(
      'no_answer',
      undefined,
      expect.objectContaining({ autoDialNext: false }),
    ))
    await waitFor(() => expect(onNextActionPick).toHaveBeenCalledWith('set_next_activity'))
    expect(onClose).toHaveBeenCalled()
  })

  it('auto-saves and advances heir queue dispositions when an outcome is picked', async () => {
    const onDisposition = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    render(
      <DispositionModal
        open
        onClose={onClose}
        onDisposition={onDisposition}
        leadName="Angela Taylor"
        phoneNumber="+18169169564"
        variant="prospecting"
        dispositions={PROSPECTING_DIALER_DISPOSITIONS}
        showVerifyToggle
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /No Answer/i }))

    await waitFor(() => {
      expect(onDisposition).toHaveBeenCalledWith(
        'no_answer',
        undefined,
        expect.objectContaining({ autoDialNext: true }),
      )
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('keeps a rail-selected reached outcome open for qualification review', () => {
    const onDisposition = vi.fn()
    render(
      <DispositionModal
        open
        onClose={() => {}}
        onDisposition={onDisposition}
        leadName="Angela Taylor"
        variant="prospecting"
        dispositions={PROSPECTING_DIALER_DISPOSITIONS}
        selectedDisposition="spoke_with_owner"
        autoSubmitOnPick={false}
        primaryActionLabel="Save & Next Number"
      />,
    )

    expect(screen.getByRole('button', { name: 'Save & Next Number' })).toBeEnabled()
    expect(onDisposition).not.toHaveBeenCalled()
  })

  it('keeps Appointment Set manual in an heir queue so the real time can be entered', () => {
    render(
      <DispositionModal
        open
        onClose={() => {}}
        onDisposition={() => true}
        leadName="Angela Taylor"
        variant="prospecting"
        dispositions={PROSPECTING_DIALER_DISPOSITIONS}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Appointment Set/i }))
    expect(screen.getByLabelText(/Appointment date and time/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save & Next Lead/i })).toBeDisabled()
  })

  it('auto-saves dead heir queue dispositions after the required reason is picked', async () => {
    const onDisposition = vi.fn().mockResolvedValue(true)

    render(
      <DispositionModal
        open
        onClose={() => {}}
        onDisposition={onDisposition}
        leadName="Angela Taylor"
        phoneNumber="+18169169564"
        variant="prospecting"
        dispositions={PROSPECTING_DIALER_DISPOSITIONS}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Dead Lead/i }))
    expect(onDisposition).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Not the owner \/ No legal interest/i }))

    await waitFor(() => {
      expect(onDisposition).toHaveBeenCalledWith(
        'dead',
        undefined,
        expect.objectContaining({
          autoDialNext: true,
          deadReason: 'no_legal_interest',
        }),
      )
    })
  })

  it('surfaces a required dead reason when the dead outcome is preselected', () => {
    const html = renderModal({
      selectedDisposition: 'dead',
    })

    expect(html).toContain('Why is it dead?')
    expect(html).toContain('Not the owner / No legal interest')
  })

  it('requires the real appointment date and forwards its ISO timestamp', async () => {
    const onDisposition = vi.fn().mockResolvedValue(true)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const localAppointment = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T15:30`

    render(
      <DispositionModal
        open
        onClose={() => {}}
        onDisposition={onDisposition}
        leadName="Jill Woods"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Appointment Set/i }))
    expect(screen.getByText('The CRM will save this exact time. It will not invent a placeholder appointment.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save & Next Lead/i })).toBeDisabled()

    const input = screen.getByLabelText(/Appointment date and time/i)
    fireEvent.change(input, { target: { value: localAppointment } })
    fireEvent.click(screen.getByRole('button', { name: /Save & Next Lead/i }))

    await waitFor(() => expect(onDisposition).toHaveBeenCalledWith(
      'appointment_set',
      undefined,
      expect.objectContaining({ appointmentAt: new Date(localAppointment).toISOString() }),
    ))
  })

  it('keeps AI output human-controlled and inserts it only after Use is clicked', () => {
    render(
      <DispositionModal
        open
        onClose={() => {}}
        onDisposition={() => true}
        leadName="Jill Woods"
        phoneNumber="+18169169564"
        aiSummary="Seller wants to move before October."
        aiSummaryStatus="ready"
      />,
    )

    const notes = screen.getByPlaceholderText('Add notes from this call...')
    expect(notes).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    expect(notes).toHaveValue('Seller wants to move before October.')
  })

  it('allows the agent to save a disposition while AI processing continues', () => {
    const html = renderModal({ aiSummaryStatus: 'processing' })

    expect(html).toContain('AI review is processing. Save the outcome without waiting.')
  })
})
