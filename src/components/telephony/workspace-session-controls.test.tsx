/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceSessionControls } from './workspace-session-controls'

describe('WorkspaceSessionControls', () => {
  it('keeps the primary session commands in one persistent rail', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy={false} outcomeRequired={false} onAction={onAction} />)

    expect(screen.getByRole('button', { name: 'Hang up current call' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Pause session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip seller' }))
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))

    expect(onAction.mock.calls).toEqual([['pause'], ['skip'], ['end']])
  })

  it('keeps hang up available in the rail for an active call', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy outcomeRequired={false} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Hang up current call' }))
    expect(onAction).toHaveBeenCalledWith('hangup')
  })

  it('resumes a paused session and blocks queue movement while an outcome is required', () => {
    const onAction = vi.fn()
    const { rerender } = render(<WorkspaceSessionControls status="paused" callBusy={false} outcomeRequired={false} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }))
    expect(onAction).toHaveBeenCalledWith('resume')

    rerender(<WorkspaceSessionControls status="active" callBusy={false} outcomeRequired onAction={onAction} />)
    expect(screen.getByRole('button', { name: 'Pause after outcome' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Skip seller' })).toBeDisabled()
  })
})
