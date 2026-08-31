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
    expect(screen.getByRole('button', { name: 'Pause & hang up' })).toBeVisible()
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

  it('cannot resume until the paused call has ended and its outcome is saved', () => {
    const onAction = vi.fn()
    const { rerender } = render(<WorkspaceSessionControls status="paused" callBusy outcomeRequired={false} onAction={onAction} />)

    expect(screen.getByRole('button', { name: 'Pausing call…' })).toBeDisabled()

    rerender(<WorkspaceSessionControls status="paused" callBusy={false} outcomeRequired onAction={onAction} />)
    expect(screen.getByRole('button', { name: 'Paused — save outcome' })).toBeDisabled()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('keeps the live control layout visible but inert in read-only preview', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy outcomeRequired previewOnly onAction={onAction} />)

    expect(screen.getByRole('button', { name: 'Hang up current call' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause & hang up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skip seller' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'End session' })).toBeDisabled()
    expect(onAction).not.toHaveBeenCalled()
  })
})
