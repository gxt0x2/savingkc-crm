'use client'

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

const BUILD_TIME_GMAPS_KEY = (
  process.env.NEXT_PUBLIC_GMAPS_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
  ''
).trim()
const MAP_LOAD_TIMEOUT_MS = 8000

interface LatLng {
  lat(): number
  lng(): number
}

interface GeocodeResult {
  geometry: { location: LatLng }
}

interface StreetViewData {
  location?: {
    pano?: string
    latLng?: LatLng
  }
}

interface StreetViewPanoramaInstance {
  getPov(): { heading: number; pitch: number }
  setPov(pov: { heading: number; pitch: number }): void
  setVisible(visible: boolean): void
}

interface GoogleMapsApi {
  maps: {
    Geocoder: new () => {
      geocode(
        request: { address: string },
        callback: (results: GeocodeResult[] | null, status: string) => void,
      ): void
    }
    Map: new (
      element: HTMLElement,
      options: Record<string, unknown>,
    ) => unknown
    Marker: new (options: Record<string, unknown>) => unknown
    StreetViewService: new () => {
      getPanorama(
        request: { location: LatLng; radius: number },
        callback: (data: StreetViewData | null, status: string) => void,
      ): void
    }
    StreetViewPanorama: new (
      element: HTMLElement,
      options: Record<string, unknown>,
    ) => StreetViewPanoramaInstance
    event?: {
      clearInstanceListeners(instance: unknown): void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleMapsApi
    __savingkcGmapsLoader?: Promise<GoogleMapsApi>
    __savingkcGmapsKey?: string
  }
}

async function getMapsKey(): Promise<string> {
  if (BUILD_TIME_GMAPS_KEY) return BUILD_TIME_GMAPS_KEY
  if (typeof window === 'undefined') throw new Error('Maps cannot load during SSR.')
  if (window.__savingkcGmapsKey) return window.__savingkcGmapsKey

  const res = await fetch('/api/google-maps-key', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const data = await res.json().catch(() => null) as { key?: string; error?: string } | null
  const key = data?.key?.trim()
  if (!res.ok || !key) {
    throw new Error(data?.error || 'Google Maps key is not configured.')
  }

  window.__savingkcGmapsKey = key
  return key
}

async function loadMapsJs(): Promise<GoogleMapsApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Maps cannot load during SSR.'))
  if (window.google?.maps) return Promise.resolve(window.google)
  if (window.__savingkcGmapsLoader) return window.__savingkcGmapsLoader
  const key = await getMapsKey()

  window.__savingkcGmapsLoader = new Promise((resolve, reject) => {
    const existing = document.getElementById('savingkc-gmaps-js') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => window.google ? resolve(window.google) : reject(new Error('Maps failed to initialize.')))
      existing.addEventListener('error', () => reject(new Error('Maps failed to load.')))
      return
    }

    const script = document.createElement('script')
    script.id = 'savingkc-gmaps-js'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`
    script.async = true
    script.defer = true
    script.onload = () => window.google ? resolve(window.google) : reject(new Error('Maps failed to initialize.'))
    script.onerror = () => reject(new Error('Maps failed to load.'))
    document.head.appendChild(script)
  })

  return window.__savingkcGmapsLoader
}

function googleMapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

function googleStreetViewUrl(address: string, location?: { lat: number; lng: number }): string {
  if (location) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${location.lat},${location.lng}`
  }

  return googleMapsSearchUrl(address)
}

function installPanoramaDragController(
  container: HTMLElement,
  panorama: StreetViewPanoramaInstance,
): () => void {
  let activeFrameDocument: Document | null = null
  let dragging = false
  let pointerId = 1
  let startPoint = { x: 0, y: 0 }
  let startPov = { heading: 0, pitch: 0 }

  function isGoogleControl(target: EventTarget | null): boolean {
    const element = target as Element | null
    if (typeof element?.closest !== 'function') return false
    return Boolean(element.closest('button, a, input, select, textarea, [role="button"], [role="link"]'))
  }

  function framePoint(event: PointerEvent) {
    const frameRect = container.querySelector('iframe')?.getBoundingClientRect()
    return {
      x: event.clientX + (frameRect?.left ?? 0),
      y: event.clientY + (frameRect?.top ?? 0),
    }
  }

  function updatePov(point: { x: number; y: number }) {
    if (!dragging) return
    const heading = startPov.heading - ((point.x - startPoint.x) * 0.25)
    const pitch = Math.max(-85, Math.min(85, startPov.pitch + ((point.y - startPoint.y) * 0.15)))
    if (Number.isFinite(heading) && Number.isFinite(pitch)) {
      panorama.setPov({ heading, pitch })
    }
  }

  function finishDrag() {
    dragging = false
    container.removeAttribute('data-dragging')
    if (activeFrameDocument) activeFrameDocument.documentElement.style.cursor = 'grab'
  }

  const onFramePointerDown = (event: Event) => {
    const pointerEvent = event as PointerEvent
    if (pointerEvent.button !== 0 || !pointerEvent.isPrimary || isGoogleControl(pointerEvent.target)) return

    dragging = true
    pointerId = pointerEvent.pointerId || 1
    startPoint = framePoint(pointerEvent)
    const currentPov = panorama.getPov()
    startPov = {
      heading: Number.isFinite(currentPov.heading) ? currentPov.heading : 0,
      pitch: Number.isFinite(currentPov.pitch) ? currentPov.pitch : 0,
    }
    container.setAttribute('data-dragging', 'true')
    if (activeFrameDocument) activeFrameDocument.documentElement.style.cursor = 'grabbing'
    pointerEvent.preventDefault()
    pointerEvent.stopImmediatePropagation()
  }
  const onFramePointerMove = (event: Event) => {
    const pointerEvent = event as PointerEvent
    if (!dragging || (pointerEvent.pointerId || 1) !== pointerId) return
    updatePov(framePoint(pointerEvent))
    pointerEvent.preventDefault()
    pointerEvent.stopImmediatePropagation()
  }
  const onFramePointerEnd = (event: Event) => {
    const pointerEvent = event as PointerEvent
    if (!dragging || (pointerEvent.pointerId || 1) !== pointerId) return
    finishDrag()
    pointerEvent.preventDefault()
    pointerEvent.stopImmediatePropagation()
  }

  function attachFrameListeners() {
    const frame = container.querySelector('iframe')
    const frameDocument = frame?.contentDocument
    if (!frameDocument || frameDocument === activeFrameDocument) return

    activeFrameDocument?.removeEventListener('pointerdown', onFramePointerDown, true)
    activeFrameDocument?.removeEventListener('pointermove', onFramePointerMove, true)
    activeFrameDocument?.removeEventListener('pointerup', onFramePointerEnd, true)
    activeFrameDocument?.removeEventListener('pointercancel', onFramePointerEnd, true)

    activeFrameDocument = frameDocument
    frameDocument.documentElement.style.cursor = 'grab'
    frameDocument.addEventListener('pointerdown', onFramePointerDown, true)
    frameDocument.addEventListener('pointermove', onFramePointerMove, true)
    frameDocument.addEventListener('pointerup', onFramePointerEnd, true)
    frameDocument.addEventListener('pointercancel', onFramePointerEnd, true)
  }

  const onWindowPointerMove = (event: PointerEvent) => {
    if (!dragging || (event.pointerId || 1) !== pointerId) return
    updatePov({ x: event.clientX, y: event.clientY })
    if (event.buttons === 0) finishDrag()
  }
  const onWindowPointerEnd = (event: PointerEvent) => {
    if (!dragging || (event.pointerId || 1) !== pointerId) return
    finishDrag()
  }
  const onWindowBlur = () => finishDrag()
  const frameObserver = new MutationObserver(attachFrameListeners)

  attachFrameListeners()
  frameObserver.observe(container, { childList: true, subtree: true })

  window.addEventListener('pointerup', onWindowPointerEnd, true)
  window.addEventListener('pointercancel', onWindowPointerEnd, true)
  window.addEventListener('pointermove', onWindowPointerMove, true)
  window.addEventListener('blur', onWindowBlur)

  return () => {
    frameObserver.disconnect()
    window.removeEventListener('pointerup', onWindowPointerEnd, true)
    window.removeEventListener('pointercancel', onWindowPointerEnd, true)
    window.removeEventListener('pointermove', onWindowPointerMove, true)
    window.removeEventListener('blur', onWindowBlur)
    activeFrameDocument?.removeEventListener('pointerdown', onFramePointerDown, true)
    activeFrameDocument?.removeEventListener('pointermove', onFramePointerMove, true)
    activeFrameDocument?.removeEventListener('pointerup', onFramePointerEnd, true)
    activeFrameDocument?.removeEventListener('pointercancel', onFramePointerEnd, true)
    activeFrameDocument = null
  }
}

function keylessMapEmbedUrl(address: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=18&t=k&output=embed`
}

function KeylessMapFrame({
  address,
  height,
  title,
}: {
  address: string
  height: number | string
  title: string
}) {
  return (
    <iframe
      src={keylessMapEmbedUrl(address)}
      width="100%"
      height={typeof height === 'number' ? String(height) : height}
      style={{ border: 0, display: 'block' }}
      loading="lazy"
      title={title}
    />
  )
}

interface PanelProps {
  address: string
  height?: number | string
}

function PanelShell({
  height,
  refEl,
  loading,
  error,
  fallbackUrl,
}: {
  height: number | string
  refEl: RefObject<HTMLDivElement | null>
  loading: boolean
  error: string | null
  fallbackUrl?: string
}) {
  return (
    <div className="relative" style={{ width: '100%', height }}>
      <div ref={refEl} style={{ width: '100%', height: '100%' }} />
      {(loading || error) && (
        <div
          className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm"
          style={{
            background: error ? 'rgba(0,0,0,0.62)' : 'transparent',
            color: error ? '#fff' : 'inherit',
            pointerEvents: 'none',
          }}
        >
          {error && fallbackUrl ? (
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/20"
            >
              Open in Google Maps
            </a>
          ) : error ?? 'Loading...'}
        </div>
      )}
    </div>
  )
}

export function StreetViewPanel(props: PanelProps) {
  return <StreetViewContent key={props.address} {...props} />
}

function StreetViewContent({ address, height = 500 }: PanelProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapsApiRef = useRef<GoogleMapsApi | null>(null)
  const panoramaRef = useRef<StreetViewPanoramaInstance | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState(() => googleMapsSearchUrl(address))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  function clearLoadingTimer() {
    if (!loadingTimer.current) return
    clearTimeout(loadingTimer.current)
    loadingTimer.current = null
  }

  useEffect(() => {
    let cancelled = false
    let removePanoramaDragController: (() => void) | null = null
    clearLoadingTimer()
    loadingTimer.current = setTimeout(() => {
      if (cancelled) return
      loadingTimer.current = null
      setError('Street View is taking too long to load.')
      setLoading(false)
    }, MAP_LOAD_TIMEOUT_MS)

    loadMapsJs()
      .then((google) => {
        if (cancelled || !canvasRef.current) return
        mapsApiRef.current = google

        const geocoder = new google.maps.Geocoder()
        geocoder.geocode({ address }, (results, status) => {
          if (cancelled || !canvasRef.current) return
          if (status !== 'OK' || !results?.[0]) {
            clearLoadingTimer()
            setError('Street View could not locate this address.')
            setLoading(false)
            return
          }

          const location = results[0].geometry.location
          const coordinates = { lat: location.lat(), lng: location.lng() }
          setFallbackUrl(googleStreetViewUrl(address, coordinates))

          const service = new google.maps.StreetViewService()
          service.getPanorama({ location, radius: 100 }, (data, panoramaStatus) => {
            if (cancelled || !canvasRef.current) return
            if (panoramaStatus !== 'OK' || !data?.location) {
              clearLoadingTimer()
              setError('Street View imagery is not available near this property.')
              setLoading(false)
              return
            }

            panoramaRef.current = new google.maps.StreetViewPanorama(canvasRef.current, {
              pano: data.location.pano,
              position: data.location.latLng ?? location,
              pov: { heading: 0, pitch: 0 },
              zoom: 0,
              addressControl: true,
              clickToGo: true,
              enableCloseButton: false,
              fullscreenControl: true,
              linksControl: true,
              motionTracking: false,
              motionTrackingControl: false,
              panControl: true,
              scrollwheel: true,
              visible: true,
            })
            removePanoramaDragController = installPanoramaDragController(
              canvasRef.current,
              panoramaRef.current,
            )

            clearLoadingTimer()
            setLoading(false)
          })
        })
      })
      .catch((err) => {
        if (cancelled) return
        clearLoadingTimer()
        setError(err instanceof Error ? err.message : 'Street View failed to load.')
        setLoading(false)
      })

    return () => {
      cancelled = true
      clearLoadingTimer()
      removePanoramaDragController?.()
      if (panoramaRef.current) {
        mapsApiRef.current?.maps.event?.clearInstanceListeners(panoramaRef.current)
        panoramaRef.current.setVisible(false)
        panoramaRef.current = null
      }
      mapsApiRef.current = null
    }
  }, [address])

  return (
    <div className="relative" style={{ width: '100%', height }}>
      <div
        ref={canvasRef}
        data-testid="street-view-canvas"
        aria-label={`Interactive Street View for ${address}`}
        style={{ width: '100%', height: '100%' }}
      />

      {(loading || error) && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm"
          style={{
            background: error ? 'rgba(0,0,0,0.72)' : 'var(--crm-surface)',
            color: error ? '#fff' : 'inherit',
            pointerEvents: error ? 'auto' : 'none',
          }}
        >
          {error ? (
            <>
              <p className="max-w-md text-sm font-semibold">{error}</p>
              <a
                href={fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/20"
              >
                Open in Google Maps
              </a>
            </>
          ) : (
            'Loading interactive Street View...'
          )}
        </div>
      )}
    </div>
  )
}

export function MapPanel({ address, height = 500 }: PanelProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    loadMapsJs()
      .then((google) => {
        if (cancelled || !ref.current) return
        const geocoder = new google.maps.Geocoder()
        geocoder.geocode({ address }, (results, status) => {
          if (cancelled || !ref.current) return
          if (status !== 'OK' || !results?.[0]) {
            setError('Address could not be located.')
            setLoading(false)
            return
          }

          const loc = results[0].geometry.location
          const map = new google.maps.Map(ref.current, {
            center: loc,
            zoom: 17,
            mapTypeId: 'hybrid',
            streetViewControl: false,
            fullscreenControl: true,
          })
          new google.maps.Marker({ map, position: loc, title: address })
          setLoading(false)
        })
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Map failed to load.')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [address])

  if (error) {
    return <KeylessMapFrame address={address} height={height} title="Map View" />
  }

  return <PanelShell height={height} refEl={ref} loading={loading} error={error} />
}
