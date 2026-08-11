/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StreetViewPanel } from '../google-map-panel'

describe('StreetViewPanel', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    delete window.__savingkcGmapsKey
  })

  it('fills a responsive viewport instead of falling back to the iframe default height', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/google-maps-key') {
        return { ok: true, json: async () => ({ key: 'test-key' }) }
      }
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [{ geometry: { location: { lat: 38.991, lng: -94.654 } } }],
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(
      <StreetViewPanel address="7405 Cherokee Dr, Prairie Village, KS 66208" height="100%" />,
    )

    await waitFor(() => expect(screen.getByTitle('Street View')).toBeInTheDocument())
    const iframe = screen.getByTitle('Street View')
    expect(iframe).toHaveAttribute('height', '100%')
    expect(iframe).toHaveStyle({ height: '100%' })
    expect(container.firstElementChild).toHaveStyle({ height: '100%' })
  })
})
