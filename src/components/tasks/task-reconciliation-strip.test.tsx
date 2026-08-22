/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskReconciliationStrip } from './task-reconciliation-strip'

const { useSnapshot } = vi.hoisted(() => ({ useSnapshot: vi.fn() }))

vi.mock('@/hooks/use-operational-reconciliation', () => ({
  useOperationalReconciliation: useSnapshot,
}))

describe('TaskReconciliationStrip', () => {
  beforeEach(() => useSnapshot.mockReset())

  it('renders honest loading and unavailable states instead of zeros', () => {
    useSnapshot.mockReturnValue({ data: undefined, isLoading: true, error: null })
    const { rerender } = render(<TaskReconciliationStrip />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading backlog health')

    useSnapshot.mockReturnValue({ data: undefined, isLoading: false, error: new Error('offline') })
    rerender(<TaskReconciliationStrip />)
    expect(screen.getByRole('status')).toHaveTextContent('Backlog health unavailable')
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('separates current work from review debt without offering bulk cleanup', () => {
    useSnapshot.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        degraded: false,
        warning: null,
        workItems: {
          overdue: 175,
          overdueCurrent: 120,
          overdueTerminal: 50,
          overdueUnlinked: 5,
          leadsWithMultipleActive: 18,
          maxActivePerLead: 4,
        },
      },
    })

    render(<TaskReconciliationStrip />)
    const region = screen.getByRole('region', { name: 'Task backlog health' })
    expect(region).toHaveTextContent('175 overdue total')
    expect(region).toHaveTextContent('Current-record overdue120')
    expect(region).toHaveTextContent('Terminal review50')
    expect(region).toHaveTextContent('Unlinked review5')
    expect(region).toHaveTextContent('Multiple active18')
    expect(region).toHaveTextContent('Nothing is auto-closed')
    expect(region).not.toHaveTextContent('Complete')
    expect(region).not.toHaveTextContent('Delete')
  })
})
