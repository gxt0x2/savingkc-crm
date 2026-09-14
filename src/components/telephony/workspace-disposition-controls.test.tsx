/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceDispositionControls } from './workspace-disposition-controls'

const labels = ['Contact', 'No Contact', 'Bad Number', 'Voicemail', 'DNC Contact', 'DNC Number']

describe('WorkspaceDispositionControls', () => {
  it('keeps the six requested outcomes visible in their exact order', () => {
    render(<WorkspaceDispositionControls outcomeRequired={false} />)

    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(labels)
    for (const label of labels) expect(screen.getByRole('button', { name: label })).toBeDisabled()
    expect(screen.getByText('Available when a call ends')).toHaveClass('sr-only')
  })

  it('maps the compact outcomes to the canonical saved results', () => {
    const onDisposition = vi.fn()
    render(<WorkspaceDispositionControls outcomeRequired onDisposition={onDisposition} />)

    fireEvent.click(screen.getByRole('button', { name: 'Contact' }))
    fireEvent.click(screen.getByRole('button', { name: 'No Contact' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bad Number' }))
    fireEvent.click(screen.getByRole('button', { name: 'Voicemail' }))
    fireEvent.click(screen.getByRole('button', { name: 'DNC Contact' }))
    fireEvent.click(screen.getByRole('button', { name: 'DNC Number' }))

    expect(onDisposition.mock.calls).toEqual([
      ['spoke_with_owner'],
      ['no_answer'],
      ['disconnected'],
      ['left_voicemail'],
      ['dnc'],
      ['dnc'],
    ])
  })

  it('shows the same controls without enabling writes in preview', () => {
    render(<WorkspaceDispositionControls outcomeRequired previewOnly />)

    expect(screen.getByText('Read-only preview')).toHaveClass('sr-only')
    expect(screen.getByRole('button', { name: 'Contact' })).toBeDisabled()
  })
})
