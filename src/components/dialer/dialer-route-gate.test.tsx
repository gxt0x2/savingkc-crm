/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DialerRouteGate } from './dialer-route-gate'

const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigation.params,
  useRouter: () => ({ replace: navigation.replace }),
}))

describe('DialerRouteGate', () => {
  beforeEach(() => {
    navigation.params = new URLSearchParams()
    navigation.replace.mockReset()
  })

  it('retires the standalone Dialer dashboard into Prospecting', async () => {
    render(<DialerRouteGate><div>Legacy dashboard</div></DialerRouteGate>)

    expect(screen.queryByText('Legacy dashboard')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Opening Prospecting')
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/prospecting'))
  })

  it('preserves the focused execution console for an authorized durable session', () => {
    navigation.params = new URLSearchParams('session_id=session-1')

    render(<DialerRouteGate><div>Calling console</div></DialerRouteGate>)

    expect(screen.getByText('Calling console')).toBeVisible()
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})
