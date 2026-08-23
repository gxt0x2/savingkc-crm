/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskReconciliationStrip } from './task-reconciliation-strip'

const { useSnapshot } = vi.hoisted(() => ({
  useSnapshot: vi.fn(),
}))

vi.mock('@/hooks/use-operational-reconciliation', () => ({
  useOperationalReconciliation: useSnapshot,
}))
describe('TaskReconciliationStrip', () => {
  beforeEach(() => {
    useSnapshot.mockReset()
  })

  it('renders honest loading and unavailable states instead of zeros', () => {
    useSnapshot.mockReturnValue({ data: undefined, isLoading: true, error: null })
    const { rerender } = render(<TaskReconciliationStrip />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading backlog health')

    useSnapshot.mockReturnValue({ data: undefined, isLoading: false, error: new Error('offline') })
    rerender(<TaskReconciliationStrip />)
    expect(screen.getByRole('status')).toHaveTextContent('Backlog health unavailable')
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows only current work and primary-action integrity', () => {
    useSnapshot.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        degraded: false,
        warning: null,
        workItems: {
          overdue: 175,
          overdueCurrent: 120,
          overdueOperatorCurrent: 11,
          overdueTerminal: 50,
          overdueUnlinked: 5,
          leadsWithMultipleActive: 18,
          maxActivePerLead: 4,
          activeOpportunities: 20,
          opportunitiesWithNoPrimary: 7,
          opportunitiesWithMultiplePrimary: 2,
        },
      },
    })

    render(<TaskReconciliationStrip />)
    const region = screen.getByRole('region', { name: 'Task backlog health' })
    expect(region).toHaveTextContent('20 active opportunities')
    expect(region).toHaveTextContent('Current overdue11')
    expect(region).toHaveTextContent('of 20 active opportunities')
    const missingPrimaryLink = screen.getByRole('link', { name: 'Review 7 missing primary' })
    expect(missingPrimaryLink).toHaveTextContent('Missing primary')
    expect(missingPrimaryLink).toHaveTextContent('7')
    expect(missingPrimaryLink).toHaveAttribute('href', '/contacts?list=all&gap=missing_next_action')
    expect(region).toHaveTextContent('Multiple primary2')
    expect(region).toHaveTextContent('Historical evidence stays in the audit record')
    expect(region).not.toHaveTextContent('Terminal review')
    expect(region).not.toHaveTextContent('Unlinked review')
    expect(region).not.toHaveTextContent('Multiple active')
    expect(region).not.toHaveTextContent('Automation review')
  })

  it('does not render review-debt or automation-quarantine census cards', () => {
    useSnapshot.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        degraded: false,
        warning: null,
        workItems: {
          overdue: 175,
          overdueCurrent: 41,
          overdueOperatorCurrent: 11,
          overdueTerminal: 131,
          overdueUnlinked: 3,
          leadsWithMultipleActive: 45,
          maxActivePerLead: 8,
          activeOpportunities: 19,
          opportunitiesWithNoPrimary: 5,
          opportunitiesWithMultiplePrimary: 1,
        },
      },
    })
    render(<TaskReconciliationStrip />)
    const region = screen.getByRole('region', { name: 'Task backlog health' })
    expect(region).toHaveTextContent('Current overdue11')
    expect(screen.getByRole('link', { name: 'Review 5 missing primary' })).toHaveTextContent('5')
    expect(region).toHaveTextContent('Multiple primary1')
    expect(region).not.toHaveTextContent('Task integrity')
    expect(region).not.toHaveTextContent('Review debt')
    expect(region).not.toHaveTextContent('Quarantine')
  })
})
