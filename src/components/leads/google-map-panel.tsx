'use client'

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

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
  getZoom(): number
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
        request: { location: LatLng; radius: number; source: string },
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
    StreetViewSource: { OUTDOOR: string }
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=quarterly`
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

function headingBetween(from: LatLng, to: LatLng): number {
  const fromLat = from.lat() * Math.PI / 180
  const toLat = to.lat() * Math.PI / 180
  const deltaLng = (to.lng() - from.lng()) * Math.PI / 180
  const y = Math.sin(deltaLng) * Math.cos(toLat)
  const x = Math.cos(fromLat) * Math.sin(toLat)
    - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng)

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
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
  const activePointerRef = useRef<{ pointerId: number; target: Element } | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState(() => googleMapsSearchUrl(address))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  function clearLoadingTimer() {
    if (!loadingTimer.current) return
    clearTimeout(loadingTimer.current)
    loadingTimer.current = null
  }

  function rememberPanoramaPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return
    activePointerRef.current = { pointerId: event.pointerId, target: event.target }
  }

  useEffect(() => {
    function finishPointer(event: PointerEvent) {
      const active = activePointerRef.current
      if (!active || active.pointerId !== event.pointerId) return
      activePointerRef.current = null
      if (event.target === active.target) return

      active.target.dispatchEvent(new PointerEvent(event.type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
      }))

      if (event.type === 'pointerup') {
        active.target.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: event.button,
          buttons: event.buttons,
          clientX: event.clientX,
          clientY: event.clientY,
        }))
      }
    }

    function cancelOnBlur() {
      const active = activePointerRef.current
      if (!active) return
      activePointerRef.current = null
      active.target.dispatchEvent(new PointerEvent('pointercancel', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: active.pointerId,
        pointerType: 'mouse',
        isPrimary: true,
      }))
    }

    window.addEventListener('pointerup', finishPointer, true)
    window.addEventListener('pointercancel', finishPointer, true)
    window.addEventListener('blur', cancelOnBlur)
    return () => {
      window.removeEventListener('pointerup', finishPointer, true)
      window.removeEventListener('pointercancel', finishPointer, true)
      window.removeEventListener('blur', cancelOnBlur)
      activePointerRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let zoomReadyTimer: ReturnType<typeof setTimeout> | null = null
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
          service.getPanorama({
            location,
            radius: 100,
            source: google.maps.StreetViewSource.OUTDOOR,
          }, (data, panoramaStatus) => {
            if (cancelled || !canvasRef.current) return
            if (panoramaStatus !== 'OK' || !data?.location) {
              clearLoadingTimer()
              setError('Street View imagery is not available near this property.')
              setLoading(false)
              return
            }

            const panoramaOptions: Record<string, unknown> = {
              pov: {
                heading: data.location.latLng
                  ? headingBetween(data.location.latLng, location)
                  : 0,
                pitch: 0,
              },
              zoom: 1,
              addressControl: false,
              clickToGo: false,
              enableCloseButton: false,
              fullscreenControl: false,
              linksControl: false,
              motionTracking: false,
              motionTrackingControl: false,
              panControl: false,
              scrollwheel: false,
              visible: true,
            }

            if (data.location.pano) panoramaOptions.pano = data.location.pano
            else panoramaOptions.position = data.location.latLng ?? location

            const panorama = new google.maps.StreetViewPanorama(canvasRef.current, panoramaOptions)
            panoramaRef.current = panorama

            const waitForStableZoom = () => {
              if (cancelled || panoramaRef.current !== panorama) return
              const zoom = panorama.getZoom()
              if (Number.isFinite(zoom)) {
                clearLoadingTimer()
                setLoading(false)
                return
              }

              zoomReadyTimer = setTimeout(waitForStableZoom, 50)
            }

            waitForStableZoom()
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
      if (zoomReadyTimer) clearTimeout(zoomReadyTimer)
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
        onPointerDownCapture={rememberPanoramaPointer}
        style={{ width: '100%', height: '100%' }}
      />

      {!loading && !error ? (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[3] flex items-center justify-between gap-3">
          <span className="rounded-lg bg-black/70 px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-sm">
            Drag to look around
          </span>
          <a
            href={fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto rounded-lg border border-white/20 bg-black/70 px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/85"
          >
            Open in Google Maps
          </a>
        </div>
      ) : null}

      {(loading || error) && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm"
          style={{
            background: error ? 'rgba(0,0,0,0.72)' : 'var(--crm-surface)',
            color: error ? '#fff' : 'inherit',
            pointerEvents: 'auto',
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
