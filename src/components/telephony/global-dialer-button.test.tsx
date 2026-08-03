// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GlobalDialerButton } from './global-dialer-button'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GlobalDialerButton', () => {
  it('opens the shared softphone through the global shell event', () => {
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent')

    render(<GlobalDialerButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Open phone dialer' }))

    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect(dispatchEvent.mock.calls[0][0]).toBeInstanceOf(Event)
    expect(dispatchEvent.mock.calls[0][0].type).toBe('open-global-dialer')
  })
})
