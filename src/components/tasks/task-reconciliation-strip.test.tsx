/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskReconciliationStrip } from './task-reconciliation-strip'

const { useSnapshot, useProvenance } = vi.hoisted(() => ({
  useSnapshot: vi.fn(),
  useProvenance: vi.fn(),
}))

vi.mock('@/hooks/use-operational-reconciliation', () => ({
  useOperationalReconciliation: useSnapshot,
}))
vi.mock('@/hooks/use-task-provenance', () => ({
  useTaskProvenance: useProvenance,
}))

describe('TaskReconciliationStrip', () => {
  beforeEach(() => {
    useSnapshot.mockReset()
    useProvenance.mockReset()
    useProvenance.mockReturnValue({ data: undefined, isLoading: true, error: null })
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
          activeOpportunities: 20,
          opportunitiesWithNoPrimary: 7,
          opportunitiesWithMultiplePrimary: 2,
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
    expect(region).toHaveTextContent('Missing primary7')
    expect(region).toHaveTextContent('of 20 active opportunities')
    expect(region).toHaveTextContent('Multiple primary2')
    expect(region).toHaveTextContent('Nothing is auto-closed')
    expect(region).not.toHaveTextContent('Complete')
    expect(region).not.toHaveTextContent('Delete')
  })

  it('shows provenance evidence without claiming the backlog was quarantined', () => {
    useSnapshot.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        degraded: false,
        warning: null,
        workItems: {
          overdue: 175,
          overdueCurrent: 41,
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
    useProvenance.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        active: 193,
        classes: {
          governed_human: { total: 0, active: 0 },
          approved_workflow: { total: 0, active: 0 },
          legacy_operator: { total: 47, active: 37 },
          event_derived: { total: 13, active: 12 },
          automation_unreviewed: { total: 68, active: 68 },
          unknown: { total: 80, active: 75 },
        },
        quality: { possibleDuplicateRows: 13 },
      },
    })

    render(<TaskReconciliationStrip />)
    const region = screen.getByRole('region', { name: 'Task backlog health' })
    expect(region).toHaveTextContent('Task integrity')
    expect(region).toHaveTextContent('Operator entered37')
    expect(region).toHaveTextContent('Event backed12')
    expect(region).toHaveTextContent('Automation review68')
    expect(region).toHaveTextContent('Unattributed75')
    expect(region).toHaveTextContent('Possible duplicates13')
    expect(region).toHaveTextContent('No tasks are hidden, completed, or deleted')
  })
})
