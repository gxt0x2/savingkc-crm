/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BottleneckDiagnostic } from '../components/BottleneckDiagnostic'

describe('BottleneckDiagnostic', () => {
  it('renders the IMG_0714 stage structure with four stage boxes and three transition rates', () => {
    render(<BottleneckDiagnostic />)

    expect(screen.getAllByTestId('diagnostic-stage')).toHaveLength(4)
    expect(screen.getAllByTestId('diagnostic-transition')).toHaveLength(3)
    expect(screen.getByRole('heading', { name: 'Lead' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Opportunity' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Appointment' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Deal' })).toBeInTheDocument()
  })

  it('renders driver checklists as proper lists', () => {
    render(<BottleneckDiagnostic />)

    expect(screen.getAllByRole('list')).toHaveLength(4)
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(8)
  })

  it('has no interactive behavior in v1', () => {
    const onClick = vi.fn()

    render(
      <div onClick={onClick}>
        <BottleneckDiagnostic />
      </div>,
    )

    fireEvent.click(screen.getByRole('heading', { name: 'Lead' }))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getAllByTestId('diagnostic-stage')).toHaveLength(4)
  })
})
