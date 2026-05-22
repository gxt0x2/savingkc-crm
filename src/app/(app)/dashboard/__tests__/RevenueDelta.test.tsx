/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RevenueDelta } from '../components/RevenueDelta'
import { compareScenarios } from '../lib/bottleneck'
import { LEFT_MAIN_FIXTURE } from '../__fixtures__/leftMain'

describe('RevenueDelta', () => {
  it('renders the revenue increase percent in #ff4d56 red', () => {
    const comparison = compareScenarios(LEFT_MAIN_FIXTURE.current.inputs, LEFT_MAIN_FIXTURE.optimized.inputs)

    render(<RevenueDelta comparison={comparison} />)

    expect(screen.getByTestId('revenue-increase-percent')).toHaveTextContent('77.78%')
    expect(screen.getByTestId('revenue-increase-percent')).toHaveStyle({ color: '#ff4d56' })
  })

  it('renders net increase in dollars', () => {
    const comparison = compareScenarios(LEFT_MAIN_FIXTURE.current.inputs, LEFT_MAIN_FIXTURE.optimized.inputs)

    render(<RevenueDelta comparison={comparison} />)

    expect(screen.getByText('$13,440')).toBeInTheDocument()
  })

  it('renders negative deltas without breaking layout', () => {
    const comparison = compareScenarios(LEFT_MAIN_FIXTURE.optimized.inputs, LEFT_MAIN_FIXTURE.current.inputs)

    render(<RevenueDelta comparison={comparison} />)

    expect(screen.getByTestId('revenue-increase-percent')).toHaveTextContent('-43.75%')
    expect(screen.getByText('-$13,440')).toBeInTheDocument()
  })

  it('shows an em dash instead of 0% for zero deltas', () => {
    const comparison = compareScenarios(LEFT_MAIN_FIXTURE.current.inputs, LEFT_MAIN_FIXTURE.current.inputs)

    render(<RevenueDelta comparison={comparison} />)

    expect(screen.getByTestId('revenue-increase-percent')).toHaveTextContent('—')
  })
})
