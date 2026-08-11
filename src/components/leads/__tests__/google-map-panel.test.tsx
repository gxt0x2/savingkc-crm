/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('captures the native panorama pointer so Google receives releases outside its frame', async () => {
    const location = { lat: () => 38.991, lng: () => -94.654 }
    const constructPanorama = vi.fn()
    const setVisible = vi.fn()
    const clearInstanceListeners = vi.fn()
    const setPointerCapture = vi.fn()
    const hasPointerCapture = vi.fn(() => true)
    const releasePointerCapture = vi.fn()
    let nativeSurface: HTMLDivElement | null = null

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
        nativeSurface = document.createElement('div')
        nativeSurface.setPointerCapture = setPointerCapture
        nativeSurface.hasPointerCapture = hasPointerCapture
        nativeSurface.releasePointerCapture = releasePointerCapture
        element.appendChild(nativeSurface)
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
    expect(constructPanorama).toHaveBeenCalledWith(canvas, expect.objectContaining({
      clickToGo: false,
      pano: 'test-pano',
      visible: true,
    }))
    expect(constructPanorama.mock.calls[0]?.[1]).not.toHaveProperty('position')

    expect(nativeSurface).not.toBeNull()
    fireEvent.pointerDown(nativeSurface!, {
      button: 0,
      buttons: 1,
      clientX: 20,
      clientY: 30,
      isPrimary: true,
      pointerId: 7,
    })
    expect(setPointerCapture).toHaveBeenCalledWith(7)

    fireEvent.pointerUp(nativeSurface!, { buttons: 0, clientX: 500, clientY: 400, pointerId: 7 })
    expect(hasPointerCapture).toHaveBeenCalledWith(7)
    expect(releasePointerCapture).toHaveBeenCalledWith(7)

    unmount()
    expect(clearInstanceListeners).toHaveBeenCalledTimes(1)
    expect(setVisible).toHaveBeenCalledWith(false)
  })
})
