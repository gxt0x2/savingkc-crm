/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LEFT_MAIN_FIXTURE } from '../__fixtures__/leftMain'
import { ScenarioPanel } from '../components/ScenarioPanel'
import { calculateScenario } from '../lib/bottleneck'

describe('ScenarioPanel', () => {
  it('renders title, all five stage rows, margin, and lead inputs', () => {
    render(
      <ScenarioPanel
        scenarioKey="current"
        title="Current State"
        inputs={LEFT_MAIN_FIXTURE.current.inputs}
        outputs={LEFT_MAIN_FIXTURE.current.expected}
        editable
        dispatch={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Current State' })).toBeInTheDocument()
    expect(screen.getByLabelText('Current State average deal margin')).toHaveValue(10000)
    expect(screen.getByLabelText('Current State total leads')).toHaveValue(100)
    expect(screen.getAllByTestId('conversion-row')).toHaveLength(5)
  })

  it('dispatches margin and lead updates', async () => {
    const user = userEvent.setup()
    const dispatch = vi.fn()

    render(
      <ScenarioPanel
        scenarioKey="current"
        title="Current State"
        inputs={LEFT_MAIN_FIXTURE.current.inputs}
        outputs={LEFT_MAIN_FIXTURE.current.expected}
        editable
        dispatch={dispatch}
      />,
    )

    await user.clear(screen.getByLabelText('Current State average deal margin'))
    await user.type(screen.getByLabelText('Current State average deal margin'), '50000')
    fireEvent.blur(screen.getByLabelText('Current State average deal margin'))

    await user.clear(screen.getByLabelText('Current State total leads'))
    await user.type(screen.getByLabelText('Current State total leads'), '120')
    fireEvent.blur(screen.getByLabelText('Current State total leads'))

    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAverageDealMargin',
      scenario: 'current',
      value: 50000,
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateTotalLeads',
      scenario: 'current',
      value: 120,
    })
  })

  it('dispatches a rate update from a conversion row', async () => {
    const user = userEvent.setup()
    const dispatch = vi.fn()

    render(
      <ScenarioPanel
        scenarioKey="optimized"
        title="Optimized State"
        inputs={LEFT_MAIN_FIXTURE.optimized.inputs}
        outputs={LEFT_MAIN_FIXTURE.optimized.expected}
        comparedInputs={LEFT_MAIN_FIXTURE.current.inputs}
        editable
        dispatch={dispatch}
      />,
    )

    const input = screen.getByLabelText('Lead Qualification rate')
    await user.clear(input)
    await user.type(input, '45')
    fireEvent.blur(input)

    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateRate',
      scenario: 'optimized',
      stage: 'leadQualification',
      value: 0.45,
    })
  })

  it('shows gross revenue from the calculation output', () => {
    const outputs = calculateScenario(LEFT_MAIN_FIXTURE.current.inputs)

    render(
      <ScenarioPanel
        scenarioKey="current"
        title="Current State"
        inputs={LEFT_MAIN_FIXTURE.current.inputs}
        outputs={outputs}
        editable
        dispatch={vi.fn()}
      />,
    )

    expect(screen.getByText('$17,280')).toBeInTheDocument()
  })

  it('makes all controls read-only when editable is false', () => {
    render(
      <ScenarioPanel
        scenarioKey="current"
        title="Current State"
        inputs={LEFT_MAIN_FIXTURE.current.inputs}
        outputs={LEFT_MAIN_FIXTURE.current.expected}
        editable={false}
        dispatch={vi.fn()}
      />,
    )

    for (const input of screen.getAllByRole('spinbutton')) {
      expect(input).toHaveAttribute('readonly')
    }
  })
})
