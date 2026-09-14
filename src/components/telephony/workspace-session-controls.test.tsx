/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceSessionControls } from './workspace-session-controls'

describe('WorkspaceSessionControls', () => {
  it('keeps the four Mojo-style controls in one persistent vertical rail', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy={false} outcomeRequired={false} onAction={onAction} />)

    const controls = screen.getAllByRole('button')
    expect(controls).toHaveLength(4)
    expect(controls[0]).toHaveAccessibleName('Redial')
    expect(controls[1]).toHaveAccessibleName('Hang up')
    expect(controls[2]).toHaveAccessibleName('Pause')
    expect(controls[3]).toHaveAccessibleName('Stop')

    fireEvent.click(screen.getByRole('button', { name: 'Redial' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onAction.mock.calls).toEqual([['redial'], ['pause'], ['end']])
  })

  it('keeps hang up available during a call while redial is locked', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy outcomeRequired={false} onAction={onAction} />)

    expect(screen.getByRole('button', { name: 'Redial' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Hang up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(onAction.mock.calls).toEqual([['hangup'], ['pause']])
  })

  it('resumes a paused session and blocks resume until the outcome is saved', () => {
    const onAction = vi.fn()
    const { rerender } = render(<WorkspaceSessionControls status="paused" callBusy={false} outcomeRequired={false} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(onAction).toHaveBeenCalledWith('resume')

    rerender(<WorkspaceSessionControls status="paused" callBusy={false} outcomeRequired onAction={onAction} />)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
  })

  it('keeps the exact control layout visible but inert in read-only preview', () => {
    render(<WorkspaceSessionControls status="active" callBusy outcomeRequired previewOnly onAction={vi.fn()} />)

    for (const label of ['Redial', 'Hang up', 'Pause', 'Stop']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
  })

  it('keeps displaced-window controls visible but inert after takeover', () => {
    render(<WorkspaceSessionControls status="active" callBusy={false} outcomeRequired={false} controlUnavailable onAction={vi.fn()} />)

    for (const label of ['Redial', 'Hang up', 'Pause', 'Stop']) {
      const control = screen.getByRole('button', { name: label })
      expect(control).toBeDisabled()
      expect(control).toHaveAttribute('title', 'Dialing control is active in another window')
    }
  })
})
