/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { BottleneckCalculator } from '../components/BottleneckCalculator'

describe('BottleneckCalculator', () => {
  it('initially renders the canonical Left Main fixture', () => {
    render(<BottleneckCalculator />)

    expect(screen.getByRole('heading', { name: 'Left Main Bottleneck Calculator' })).toBeInTheDocument()
    expect(screen.getByLabelText('Current State total leads')).toHaveValue(100)
    expect(screen.getByLabelText('Optimized State total leads')).toHaveValue(100)
    expect(screen.getByText('$17,280')).toBeInTheDocument()
    expect(screen.getByText('$30,720')).toBeInTheDocument()
  })

  it('editing current panel updates optimized comparison columns', async () => {
    const user = userEvent.setup()

    render(<BottleneckCalculator />)

    const optimizedPanel = screen.getByTestId('scenario-optimized')
    expect(within(optimizedPanel).getAllByText('+33%').length).toBeGreaterThan(0)

    const currentInput = within(screen.getByTestId('scenario-current')).getByLabelText('Lead Qualification rate')
    await user.clear(currentInput)
    await user.type(currentInput, '35')
    fireEvent.blur(currentInput)

    expect(within(optimizedPanel).getByText('+14%')).toBeInTheDocument()
  })

  it('editing optimized panel updates revenue delta', async () => {
    const user = userEvent.setup()

    render(<BottleneckCalculator />)

    const optimizedInput = within(screen.getByTestId('scenario-optimized')).getByLabelText('Contract to Assignment rate')
    await user.clear(optimizedInput)
    await user.type(optimizedInput, '60')
    fireEvent.blur(optimizedInput)

    expect(screen.getByTestId('revenue-increase-percent')).toHaveTextContent('33.33%')
  })

  it('editing current margin updates current revenue', async () => {
    const user = userEvent.setup()

    render(<BottleneckCalculator />)

    const marginInput = within(screen.getByTestId('scenario-current')).getByLabelText('Current State average deal margin')
    await user.clear(marginInput)
    await user.type(marginInput, '50000')
    fireEvent.blur(marginInput)

    expect(within(screen.getByTestId('scenario-current')).getByText('$86,400')).toBeInTheDocument()
  })

  it('reset restores the Left Main defaults', async () => {
    const user = userEvent.setup()

    render(<BottleneckCalculator />)

    const currentInput = screen.getByLabelText('Current State total leads')
    await user.clear(currentInput)
    await user.type(currentInput, '120')
    fireEvent.blur(currentInput)

    expect(currentInput).toHaveValue(120)

    await user.click(screen.getByRole('button', { name: 'Reset Left Main scenario' }))

    expect(screen.getByLabelText('Current State total leads')).toHaveValue(100)
    expect(screen.getByText('$17,280')).toBeInTheDocument()
  })

  it('keeps calculator controls within two component layers of the reducer container', () => {
    render(<BottleneckCalculator />)

    expect(screen.getByTestId('bottleneck-calculator')).toHaveAttribute('data-control-depth', '2')
  })
})
