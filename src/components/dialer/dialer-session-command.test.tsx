/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DialerSessionCommand } from './dialer-session-command'

function renderCommand(overrides: Partial<React.ComponentProps<typeof DialerSessionCommand>> = {}) {
  const props: React.ComponentProps<typeof DialerSessionCommand> = {
    queueLabel: 'Mojo Training List',
    currentLabel: 'Mojo Contact',
    currentIndex: 0,
    queueSize: 31,
    durableStatus: 'active',
    queueState: {
      queueItem: { phone: '+18165550199', heirName: 'Mojo Contact', relation: 'owner' },
      queueIndex: 0,
      queueLength: 3,
      callDuration: null,
      status: 'ready',
    },
    actionPending: false,
    error: null,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onEndSession: vi.fn(),
    onMarkDead: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  }

  render(<DialerSessionCommand {...props} />)
  return props
}

describe('DialerSessionCommand', () => {
  it('uses only Status, List, Current, and Progress in the top row', () => {
    renderCommand()

    const summary = screen.getByRole('region', { name: 'Calling session summary' })
    expect(within(summary).getByText('Status')).toBeVisible()
    expect(within(summary).getByText('List')).toBeVisible()
    expect(within(summary).getByText('Current')).toBeVisible()
    expect(within(summary).getByText('Progress')).toBeVisible()
    expect(within(summary).getByText('Mojo Training List')).toBeVisible()
    expect(within(summary).getByText('Mojo Contact')).toBeVisible()
    expect(within(summary).getByText('1 / 31')).toBeVisible()
    expect(screen.queryByText('Dialer time')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to campaigns' })).not.toBeInTheDocument()
  })

  it('shows the live call duration in Status without repeating contact data', () => {
    renderCommand({
      queueState: {
        queueItem: { phone: '+18165550199', heirName: 'Mojo Contact', relation: 'owner' },
        queueIndex: 0,
        queueLength: 3,
        callDuration: '03:12',
        status: 'on_call',
      },
    })

    expect(screen.getByText('Live · 03:12')).toBeVisible()
  })

  it('keeps the compact status row wired to the persistent dialer commands', () => {
    const props = renderCommand()

    act(() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'pause' } })))
    act(() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'skip' } })))
    expect(props.onPause).toHaveBeenCalledOnce()
    expect(props.onSkip).toHaveBeenCalledOnce()
  })

  it('requires confirmation when the persistent dialer ends the session', () => {
    const props = renderCommand()

    act(() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'end' } })))
    const dialog = screen.getByRole('dialog', { name: 'Stop this session?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'End session' }))

    expect(props.onEndSession).toHaveBeenCalledOnce()
  })

  it('keeps a displaced window visible but blocks its command events', () => {
    const props = renderCommand({ controlUnavailable: true })

    expect(screen.getByText('Control unavailable')).toBeVisible()
    expect(screen.getByText(/current record remains visible/i)).toBeVisible()
    act(() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'pause' } })))
    expect(props.onPause).not.toHaveBeenCalled()
  })

  it('offers a control recheck without claiming that another window took over', () => {
    const onCheckControl = vi.fn()
    renderCommand({ controlUnavailable: true, onCheckControl })
    expect(screen.queryByText(/moved to another window/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check dialing control' }))
    expect(onCheckControl).toHaveBeenCalledOnce()
  })

  it.each(['calling', 'on_call', 'incoming', 'outcome'] as const)('rejects skip commands while %s', (state) => {
    const props = renderCommand({ queueState: {
      queueItem: null, queueIndex: 0, queueLength: 0,
      status: state === 'outcome' ? 'ready' : state,
      outcomeRequired: state === 'outcome',
    } })
    act(() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'skip' } })))
    expect(props.onSkip).not.toHaveBeenCalled()
  })

  it('mirrors preview status in the same four-cell row', () => {
    renderCommand({ readOnlyPreview: true, durableStatus: undefined })

    expect(screen.getByText('Ready')).toBeVisible()
    act(() => window.dispatchEvent(new CustomEvent('prospecting-preview-status', { detail: { status: 'Paused' } })))
    expect(screen.getByText('Paused')).toBeVisible()
    act(() => window.dispatchEvent(new CustomEvent('prospecting-preview-status', { detail: { status: 'Outcome required' } })))
    expect(screen.getByText('Outcome required')).toBeVisible()
  })
})
