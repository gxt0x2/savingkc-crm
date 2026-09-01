/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceSessionControls } from './workspace-session-controls'

describe('WorkspaceSessionControls', () => {
  it('keeps the primary session commands in one persistent rail', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy={false} outcomeRequired={false} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pause session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip seller' }))
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))

    expect(onAction.mock.calls).toEqual([['pause'], ['skip'], ['end']])
  })

  it('uses pause-and-hang-up as the only footer call interruption', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy outcomeRequired={false} onAction={onAction} />)

    expect(screen.queryByRole('button', { name: 'Hang up current call' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pause & hang up' }))
    expect(onAction).toHaveBeenCalledWith('pause')
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

    expect(screen.getByRole('button', { name: 'Pause & hang up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skip seller' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'End session' })).toBeDisabled()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('keeps displaced-window controls visible but inert after takeover', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy={false} outcomeRequired={false} controlUnavailable onAction={onAction} />)

    const pause = screen.getByRole('button', { name: 'Pause session' })
    const skip = screen.getByRole('button', { name: 'Skip seller' })
    const end = screen.getByRole('button', { name: 'End session' })
    expect(pause).toBeDisabled()
    expect(skip).toBeDisabled()
    expect(end).toBeDisabled()
    expect(pause).toHaveAttribute('title', 'Dialing control is active in another window')

    fireEvent.click(pause)
    fireEvent.click(skip)
    fireEvent.click(end)
    expect(onAction).not.toHaveBeenCalled()
  })
})
