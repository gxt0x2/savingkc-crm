/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DialerSessionCommand } from './dialer-session-command'

function renderCommand(overrides: Partial<React.ComponentProps<typeof DialerSessionCommand>> = {}) {
  const props: React.ComponentProps<typeof DialerSessionCommand> = {
    queueLabel: 'August absentee owners',
    currentIndex: 3,
    queueSize: 20,
    callerId: '+18165550123',
    durableSessionId: 'session-1',
    durableStatus: 'active',
    dials: 7,
    contacts: 2,
    queueState: {
      queueItem: { phone: '+18165550199', heirName: 'Helen Seller', relation: 'daughter' },
      queueIndex: 0,
      queueLength: 3,
      callDuration: null,
      status: 'ready',
    },
    actionPending: false,
    currentLeadId: 'lead-1',
    error: null,
    onClose: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onMarkDead: vi.fn(),
    onPrevious: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  }

  render(<DialerSessionCommand {...props} />)
  return props
}

describe('DialerSessionCommand', () => {
  it('makes the single-line operator rhythm and current seller dominant', () => {
    renderCommand()

    expect(screen.getByRole('region', { name: 'Calling floor command center' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Stay in rhythm. One seller at a time.' })).toBeVisible()
    expect(screen.getByText('Helen Seller')).toBeVisible()
    expect(screen.getByText('(816) 555-0199')).toBeVisible()
    expect(screen.getByText('Calling from (816) 555-0123')).toBeVisible()
    expect(screen.getByText('Required before advancing')).toBeVisible()
    expect(screen.getByText('20%')).toBeVisible()
  })

  it('keeps durable pause, stop, skip, and exit actions wired', () => {
    const props = renderCommand()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    fireEvent.click(screen.getByRole('button', { name: /Skip contact/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause and exit session' }))

    expect(props.onStop).toHaveBeenCalledOnce()
    expect(props.onSkip).toHaveBeenCalledOnce()
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('offers an explicit resume action for paused durable sessions', () => {
    const props = renderCommand({ durableStatus: 'paused' })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(props.onResume).toHaveBeenCalledOnce()
  })

  it('shows live connected state without adding predictive or parallel-line claims', () => {
    renderCommand({
      queueState: {
        queueItem: { phone: '+18165550199', heirName: 'Helen Seller', relation: 'daughter' },
        queueIndex: 1,
        queueLength: 3,
        callDuration: '03:12',
        status: 'on_call',
      },
    })

    expect(screen.getByText('Connected now')).toBeVisible()
    expect(screen.getAllByText('03:12').length).toBeGreaterThan(0)
    expect(screen.queryByText(/predictive/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/3 lines/i)).not.toBeInTheDocument()
  })
})
