// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DispositionModal } from './disposition-modal'

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
  it('defaults normal dialer calls to the canonical outcome grid', () => {
    const html = renderModal()

    expect(html).toContain('grid grid-cols-2 xl:grid-cols-3')
    expect(html).toContain('Reached Heir')
    expect(html).toContain('No Answer')
    expect(html).toContain('Left Voicemail')
    expect(html).toContain('Dead Lead')
    expect(html).toContain('Save &amp; Next Lead')
  })

  it('keeps heir queue controls scoped to heir queue dispositions', () => {
    const html = renderModal({
      variant: 'heirQueue',
      markAsLeadAvailable: true,
      markAsLeadLabel: 'Mark Angela Taylor as lead',
      showVerifyToggle: true,
      verifyLabel: 'Verified — this is Angela Taylor',
      primaryActionLabel: 'Save & Next Number',
    })

    expect(html).toContain('grid grid-cols-2 xl:grid-cols-3')
    expect(html).toContain('Mark Angela Taylor as lead')
    expect(html).toContain('Verified — this is Angela Taylor')
    expect(html).not.toContain('Save &amp; Next Number')
    expect(html).not.toContain('Save &amp; Close')
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
        variant="heirQueue"
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

  it('auto-saves dead heir queue dispositions after the required reason is picked', async () => {
    const onDisposition = vi.fn().mockResolvedValue(true)

    render(
      <DispositionModal
        open
        onClose={() => {}}
        onDisposition={onDisposition}
        leadName="Angela Taylor"
        phoneNumber="+18169169564"
        variant="heirQueue"
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
})
