/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from '@testing-library/react'
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
    onPause: vi.fn(),
    onResume: vi.fn(),
    onEndSession: vi.fn(),
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
    expect(screen.queryByText('Caller ID')).not.toBeInTheDocument()
    expect(screen.queryByText('Sellers worked')).not.toBeInTheDocument()
    expect(screen.getByText('Current call')).toBeVisible()
    expect(screen.getByText('Calls')).toBeVisible()
    expect(screen.getByText('Contacts')).toBeVisible()
    expect(screen.getByText('Seller progress')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Live session status' }).querySelectorAll('article')).toHaveLength(4)
    expect(screen.getByRole('region', { name: 'Live session status' }).querySelector('[data-tone="info"]')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Live session status' }).querySelector('[data-tone="brand"]')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Live session status' }).querySelector('[data-tone="success"]')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Live session status' }).querySelector('[data-tone="warning"]')).toBeVisible()
    expect(screen.queryByText('Helen Seller')).not.toBeInTheDocument()
    expect(screen.queryByText('(816) 555-0199')).not.toBeInTheDocument()
    expect(screen.getByText('Session progress 20%')).toBeInTheDocument()
  })

  it('shows caller rotation as a read-only session policy', () => {
    renderCommand({ callerPolicyLabel: 'Rotating 3 approved lines every 50 calls' })
    expect(screen.getByText('Rotating 3 approved lines every 50 calls')).toBeVisible()
  })

  it('makes ending a durable session explicit and requires confirmation', () => {
    const props = renderCommand()

    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    const dialog = screen.getByRole('dialog', { name: 'Stop this session?' })
    expect(dialog).toBeVisible()
    expect(props.onEndSession).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'End session' }))

    expect(props.onEndSession).toHaveBeenCalledOnce()
  })

  it('keeps skip, pause, and exit actions distinct from ending the session', () => {
    const props = renderCommand()

    fireEvent.click(screen.getByRole('button', { name: /Skip seller/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to campaigns' }))

    expect(props.onSkip).toHaveBeenCalledOnce()
    expect(props.onPause).toHaveBeenCalledOnce()
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('uses the persistent call rail as the single home for call actions', () => {
    const props = renderCommand({ controlsDocked: true })

    expect(screen.queryByRole('button', { name: 'Call controls' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause session' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to campaigns' })).toBeVisible()

    window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'pause' } }))
    expect(props.onPause).toHaveBeenCalledOnce()
  })

  it('shows a truthful outcome-required state instead of reporting an idle call', () => {
    renderCommand({ queueState: {
      queueItem: { phone: '+18165550199', heirName: 'Helen Seller', relation: 'daughter' },
      queueIndex: 0,
      queueLength: 3,
      status: 'ready',
      outcomeRequired: true,
    } })

    expect(screen.getByText('Outcome required')).toBeVisible()
    expect(screen.getByText('Outcome', { exact: true })).toBeVisible()
  })

  it('lets an agent reopen hidden call controls without restarting the session', () => {
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent')
    renderCommand()

    fireEvent.click(screen.getByRole('button', { name: 'Call controls' }))

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'show-dialer-controls' }))
  })

  it('offers an explicit resume action for paused durable sessions', () => {
    const props = renderCommand({ durableStatus: 'paused' })
    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }))
    expect(props.onResume).toHaveBeenCalledOnce()
  })

  it('shows live connected state without adding predictive or parallel-line claims', () => {
    const props = renderCommand({
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
    expect(screen.getByRole('button', { name: 'Hang up' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    const dialog = screen.getByRole('dialog', { name: 'Stop this session?' })
    expect(within(dialog).getByText(/current call will hang up now/i)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'End call & session' }))
    expect(props.onEndSession).toHaveBeenCalledOnce()
  })

  it('shows a durable pending-stop state and disables queue-changing actions', () => {
    renderCommand({ stopRequested: true })

    expect(screen.getByText('Ending after outcome')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Skip seller/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause session' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to campaigns' })).toBeDisabled()
  })

  it('uses theme-owned surfaces instead of a permanently dark command banner', () => {
    renderCommand()
    const command = screen.getByRole('region', { name: 'Calling floor command center' })
    expect(command).toHaveClass('bg-[var(--ck-surface)]')
    expect(command).toHaveClass('text-[var(--ck-text)]')
    expect(command).not.toHaveClass('bg-[#101827]')
  })

  it('makes a workflow preview navigable without exposing calling or record mutations', () => {
    const props = renderCommand({ readOnlyPreview: true, durableSessionId: '', durableStatus: undefined })

    expect(screen.getByRole('heading', { name: 'Calling workflow preview' })).toBeVisible()
    expect(screen.getByText(/Resume calling restores the saved seller/i)).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Open live calling' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Call controls' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dead' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(props.onSkip).toHaveBeenCalledOnce()
  })
})
