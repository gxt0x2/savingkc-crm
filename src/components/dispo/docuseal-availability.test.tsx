/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DocusealUnavailableNotice,
  useDocusealAvailability,
} from './docuseal-availability'

function AvailabilityProbe() {
  const availability = useDocusealAvailability()
  const state = availability.checking ? 'checking' : availability.enabled ? 'enabled' : 'disabled'
  return <div data-testid="availability-state">{state}</div>
}

describe('DocuSeal availability UI', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows a clear, non-interactive unavailable state', () => {
    render(<DocusealUnavailableNotice />)

    expect(screen.getByRole('status').textContent).toContain('Assignment signing temporarily unavailable')
  })

  it('fails closed when the server status cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    render(<AvailabilityProbe />)

    expect(screen.getByTestId('availability-state').textContent).toBe('checking')
    await waitFor(() => {
      expect(screen.getByTestId('availability-state').textContent).toBe('disabled')
    })
  })

  it('enables actions only when the server status explicitly enables them', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AvailabilityProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('availability-state').textContent).toBe('enabled')
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/docuseal/status', { cache: 'no-store' })
  })
})
