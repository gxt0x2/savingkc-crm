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
  it('keeps session status compact without duplicating the seller or phone workspace', () => {
    renderCommand()

    expect(screen.getByRole('region', { name: 'Calling floor command center' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Calling session' })).toBeVisible()
    expect(screen.getByText('August absentee owners')).toBeVisible()
    expect(screen.getByText('Assigned line (816) 555-0123')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Live session status' })).toBeVisible()
    expect(screen.getByText('Caller ID')).toBeVisible()
    expect(screen.getByText('(816) 555-0123', { exact: true })).toBeVisible()
    expect(screen.getByText('Session calls')).toBeVisible()
    expect(screen.getByText('Sellers worked')).toBeVisible()
    expect(screen.getByText('Session contacts')).toBeVisible()
    expect(screen.getByText('Current seller')).toBeVisible()
    expect(screen.queryByText('Helen Seller')).not.toBeInTheDocument()
    expect(screen.queryByText('(816) 555-0199')).not.toBeInTheDocument()
    expect(screen.getByText('Session progress 20%')).toBeInTheDocument()
  })

  it('shows caller rotation as a read-only session policy', () => {
    renderCommand({ callerPolicyLabel: 'Rotating 3 approved lines every 50 calls' })
    expect(screen.getByText('Rotating 3 approved lines every 50 calls')).toBeVisible()
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

  it('lets an agent reopen hidden call controls without restarting the session', () => {
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent')
    renderCommand()

    fireEvent.click(screen.getByRole('button', { name: 'Call controls' }))

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'show-dialer-controls' }))
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

  it('makes a workflow preview navigable without exposing calling or record mutations', () => {
    const props = renderCommand({ readOnlyPreview: true, durableSessionId: '', durableStatus: undefined })

    expect(screen.getByRole('heading', { name: 'Calling workflow preview' })).toBeVisible()
    expect(screen.getByText(/use Open live calling to start a real session in production/i)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open live calling' })).toHaveAttribute('href', 'https://crm.savingkc.com/prospecting')
    expect(screen.queryByRole('button', { name: 'Call controls' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dead' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(props.onSkip).toHaveBeenCalledOnce()
  })
})
