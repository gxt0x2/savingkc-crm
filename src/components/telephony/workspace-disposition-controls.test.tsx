/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceDispositionControls } from './workspace-disposition-controls'

describe('WorkspaceDispositionControls', () => {
  it('keeps the canonical prospecting results visible but locked until a call ends', () => {
    render(<WorkspaceDispositionControls outcomeRequired={false} />)

    expect(screen.getByRole('button', { name: 'Reached Person' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'No Answer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Disconnected' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Do Not Call' })).toBeDisabled()
    expect(screen.getByText('Available when a call ends')).toBeVisible()
  })

  it('sends one explicit result when the call needs an outcome', () => {
    const onDisposition = vi.fn()
    render(<WorkspaceDispositionControls outcomeRequired onDisposition={onDisposition} />)

    fireEvent.click(screen.getByRole('button', { name: 'No Answer' }))
    expect(onDisposition).toHaveBeenCalledWith('no_answer')

    fireEvent.click(screen.getByRole('button', { name: 'Disconnected' }))
    expect(onDisposition).toHaveBeenCalledWith('disconnected')
    expect(screen.getByRole('button', { name: 'Disconnected' })).toHaveClass('w-full', 'min-w-0')
    expect(screen.getByText('Disconnected')).toHaveClass('whitespace-normal', 'break-words')
  })

  it('shows the same controls without enabling writes in preview', () => {
    render(<WorkspaceDispositionControls outcomeRequired previewOnly />)

    expect(screen.getByText('Read-only preview')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Reached Person' })).toBeDisabled()
  })
})
