/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConversionRow } from '../components/ConversionRow'

describe('ConversionRow', () => {
  it('renders label, percentage input, and computed count', () => {
    render(<ConversionRow label="Lead Qualification" rate={0.3} count={30} editable onChange={vi.fn()} />)

    expect(screen.getByText('Lead Qualification')).toBeInTheDocument()
    expect(screen.getByLabelText('Lead Qualification rate')).toHaveValue('30')
    expect(screen.getByText('30.00')).toBeInTheDocument()
  })

  it('accepts a decimal rate and displays it as a percent', () => {
    render(<ConversionRow label="Lead Qualification" rate={0.3} count={30} editable onChange={vi.fn()} />)

    expect(screen.getByLabelText('Lead Qualification rate')).toHaveValue('30')
  })

  it('fires onChange with decimal value after editing and blurring', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<ConversionRow label="Lead Qualification" rate={0.3} count={30} editable onChange={onChange} />)

    const input = screen.getByLabelText('Lead Qualification rate')
    await user.clear(input)
    await user.type(input, '45')
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(0.45)
  })

  it('clamps values above 100 percent to 100 percent', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<ConversionRow label="Lead Qualification" rate={0.3} count={30} editable onChange={onChange} />)

    const input = screen.getByLabelText('Lead Qualification rate')
    await user.clear(input)
    await user.type(input, '150')
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('rejects negative values without firing onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<ConversionRow label="Lead Qualification" rate={0.3} count={30} editable onChange={onChange} />)

    const input = screen.getByLabelText('Lead Qualification rate')
    await user.clear(input)
    await user.type(input, '-1')
    fireEvent.blur(input)

    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('30')
  })

  it('rejects non-numeric values without crashing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<ConversionRow label="Lead Qualification" rate={0.3} count={30} editable onChange={onChange} />)

    const input = screen.getByLabelText('Lead Qualification rate')
    await user.clear(input)
    await user.type(input, 'abc')
    fireEvent.blur(input)

    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('30')
  })

  it('shows a positive comparison delta when comparedRate is lower', () => {
    render(
      <ConversionRow
        label="Lead Qualification"
        rate={0.4}
        count={40}
        comparedRate={0.3}
        editable
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('+33%')).toHaveAttribute('data-tone', 'positive')
  })

  it('shows a neutral comparison delta when rates are equal', () => {
    render(
      <ConversionRow
        label="Lead Qualification"
        rate={0.3}
        count={30}
        comparedRate={0.3}
        editable
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('0%')).toHaveAttribute('data-tone', 'neutral')
  })

  it('shows a negative comparison delta with red styling when comparedRate is higher', () => {
    render(
      <ConversionRow
        label="Lead Qualification"
        rate={0.2}
        count={20}
        comparedRate={0.3}
        editable
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('-33%')).toHaveAttribute('data-tone', 'negative')
  })

  it('shows a neutral comparison delta when both compared rates are zero', () => {
    render(
      <ConversionRow
        label="Lead Qualification"
        rate={0}
        count={0}
        comparedRate={0}
        editable
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('0%')).toHaveAttribute('data-tone', 'neutral')
  })

  it('shows a positive comparison delta when comparedRate is zero and rate is non-zero', () => {
    render(
      <ConversionRow
        label="Lead Qualification"
        rate={0.4}
        count={40}
        comparedRate={0}
        editable
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('+100%')).toHaveAttribute('data-tone', 'positive')
  })

  it('hides the comparison column when comparedRate is absent', () => {
    render(<ConversionRow label="Lead Qualification" rate={0.3} count={30} editable onChange={vi.fn()} />)

    expect(screen.queryByTestId('rate-delta')).not.toBeInTheDocument()
  })
})
