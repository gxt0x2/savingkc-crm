/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StreetViewPanel } from '../google-map-panel'

describe('StreetViewPanel', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    delete window.google
    delete window.__savingkcGmapsLoader
    delete window.__savingkcGmapsKey
  })

  it('uses a same-document panorama so drag release cannot be trapped in a cross-origin iframe', async () => {
    const location = { lat: () => 38.991, lng: () => -94.654 }
    const constructPanorama = vi.fn()
    const setVisible = vi.fn()
    const clearInstanceListeners = vi.fn()

    class MockGeocoder {
      geocode(
        _request: { address: string },
        callback: (results: Array<{ geometry: { location: typeof location } }>, status: string) => void,
      ) {
        callback([{ geometry: { location } }], 'OK')
      }
    }

    class MockStreetViewService {
      getPanorama(
        _request: { location: typeof location; radius: number },
        callback: (data: { location: { pano: string; latLng: typeof location } }, status: string) => void,
      ) {
        callback({ location: { pano: 'test-pano', latLng: location } }, 'OK')
      }
    }

    class MockStreetViewPanorama {
      constructor(element: HTMLElement, options: Record<string, unknown>) {
        constructPanorama(element, options)
      }

      setVisible = setVisible
    }

    window.google = {
      maps: {
        Geocoder: MockGeocoder,
        Map: class {},
        Marker: class {},
        StreetViewService: MockStreetViewService,
        StreetViewPanorama: MockStreetViewPanorama,
        event: { clearInstanceListeners },
      },
    }

    const { container, unmount } = render(
      <StreetViewPanel address="7405 Cherokee Dr, Prairie Village, KS 66208" height="100%" />,
    )

    await waitFor(() => expect(constructPanorama).toHaveBeenCalledTimes(1))
    const canvas = screen.getByTestId('street-view-canvas')
    expect(canvas).toHaveStyle({ height: '100%' })
    expect(container.firstElementChild).toHaveStyle({ height: '100%' })
    expect(container.querySelector('iframe')).toBeNull()
    expect(constructPanorama).toHaveBeenCalledWith(canvas, expect.objectContaining({
      clickToGo: true,
      pano: 'test-pano',
      visible: true,
    }))

    unmount()
    expect(clearInstanceListeners).toHaveBeenCalledTimes(1)
    expect(setVisible).toHaveBeenCalledWith(false)
  })
})
