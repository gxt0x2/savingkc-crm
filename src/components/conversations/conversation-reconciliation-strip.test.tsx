/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationReconciliationStrip } from './conversation-reconciliation-strip'

const { useSnapshot } = vi.hoisted(() => ({ useSnapshot: vi.fn() }))

vi.mock('@/hooks/use-operational-reconciliation', () => ({
  useOperationalReconciliation: useSnapshot,
}))

describe('ConversationReconciliationStrip', () => {
  beforeEach(() => useSnapshot.mockReset())

  it('renders honest loading and unavailable states', () => {
    useSnapshot.mockReturnValue({ data: undefined, isLoading: true, error: null })
    const { rerender } = render(<ConversationReconciliationStrip />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading Needs Reply mix')

    useSnapshot.mockReturnValue({ data: undefined, isLoading: false, error: new Error('offline') })
    rerender(<ConversationReconciliationStrip />)
    expect(screen.getByRole('status')).toHaveTextContent('Needs Reply mix unavailable')
    expect(screen.getByRole('status')).toHaveTextContent('No threads are hidden')
  })

  it('shows known, unmatched, and terminal-review demand without dismissal controls', () => {
    useSnapshot.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        degraded: false,
        warning: null,
        conversations: { known: 30, unmatched: 95, terminalKnown: 3 },
      },
    })

    render(<ConversationReconciliationStrip />)
    const region = screen.getByRole('region', { name: 'Needs Reply mix' })
    expect(region).toHaveTextContent('30 known contacts')
    expect(region).toHaveTextContent('95 unmatched')
    expect(region).toHaveTextContent('3 terminal review')
    expect(region).toHaveTextContent('Nothing is auto-dismissed')
    expect(region).not.toHaveTextContent('Resolve')
    expect(region).not.toHaveTextContent('Delete')
  })
})
