/** @vitest-environment jsdom */

import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/dialer-session-client', () => ({ loadDialerTodayMetrics: mocks.load }))

import { useDialerTodayMetrics } from './use-dialer-today-metrics'

function Harness() {
  const metrics = useDialerTodayMetrics()
  return <p>{metrics ? `${metrics.calls}/${metrics.contacts}` : 'Unavailable'}</p>
}

describe('useDialerTodayMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.load.mockResolvedValue({ calls: 12, contacts: 3 })
  })

  it('loads once and refreshes at a recorded workflow boundary', async () => {
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('12/3')).toBeVisible())

    mocks.load.mockResolvedValue({ calls: 13, contacts: 4 })
    act(() => window.dispatchEvent(new Event('crm:disposition-logged')))

    await waitFor(() => expect(screen.getByText('13/4')).toBeVisible())
    expect(mocks.load).toHaveBeenCalledTimes(2)
  })
})
