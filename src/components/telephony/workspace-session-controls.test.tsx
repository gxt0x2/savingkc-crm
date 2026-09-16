/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceSessionControls } from './workspace-session-controls'

describe('WorkspaceSessionControls', () => {
  it('lets an idle seller be skipped without placing another call', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy={false} outcomeRequired={false} onAction={onAction} />)

    const controls = screen.getAllByRole('button')
    expect(controls).toHaveLength(5)
    expect(controls[0]).toHaveAccessibleName('Redial')
    expect(controls[1]).toHaveAccessibleName('Hang up')
    expect(controls[2]).toHaveAccessibleName('Pause')
    expect(controls[3]).toHaveAccessibleName('Skip seller')
    expect(controls[4]).toHaveAccessibleName('Stop')

    fireEvent.click(screen.getByRole('button', { name: 'Redial' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip seller' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onAction.mock.calls).toEqual([['redial'], ['pause'], ['skip'], ['end']])
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

    for (const label of ['Redial', 'Hang up', 'Pause', 'Skip seller', 'Stop']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
  })

  it('keeps displaced-window controls visible but inert after takeover', () => {
    render(<WorkspaceSessionControls status="active" callBusy={false} outcomeRequired={false} controlUnavailable onAction={vi.fn()} />)

    for (const label of ['Redial', 'Hang up', 'Pause', 'Skip seller', 'Stop']) {
      const control = screen.getByRole('button', { name: label })
      expect(control).toBeDisabled()
      expect(control).toHaveAttribute('title', 'Dialing control is active in another window')
    }
  })

  it.each([
    { status: 'active' as const, callBusy: true, outcomeRequired: false },
    { status: 'active' as const, callBusy: false, outcomeRequired: true },
    { status: 'paused' as const, callBusy: false, outcomeRequired: false },
    { status: 'completed' as const, callBusy: false, outcomeRequired: false },
    { status: 'stopped' as const, callBusy: false, outcomeRequired: false },
  ])('protects calls, outcomes and inactive sessions from skips: %j', (props) => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls {...props} onAction={onAction} />)
    const skip = screen.getByRole('button', { name: 'Skip seller' })
    expect(skip).toBeDisabled()
    fireEvent.click(skip)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('allows skipping a seller with no dialable number', () => {
    const onAction = vi.fn()
    render(<WorkspaceSessionControls status="active" callBusy={false} outcomeRequired={false} redialReady={false} onAction={onAction} />)
    expect(screen.getByRole('button', { name: 'Redial' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Skip seller' }))
    expect(onAction).toHaveBeenCalledWith('skip')
  })
})
