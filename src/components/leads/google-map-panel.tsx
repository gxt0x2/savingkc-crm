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
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
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
    const controller = new AbortController()

    clearLoadingTimer()
    loadingTimer.current = setTimeout(() => {
      if (cancelled) return
      loadingTimer.current = null
      setError('Street View is taking too long to load.')
      setLoading(false)
    }, MAP_LOAD_TIMEOUT_MS)

    getMapsKey()
      .then(async (key) => {
        const params = new URLSearchParams({ address, key })
        const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
          signal: controller.signal,
        })
        const data = await res.json().catch(() => null) as {
          status?: string
          error_message?: string
          results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>
        } | null

        if (cancelled) return

        if (!res.ok || !data || data.status !== 'OK') {
          clearLoadingTimer()
          setError(data?.error_message || 'Street View could not locate this address.')
          setLoading(false)
          return
        }

        const location = data.results?.[0]?.geometry?.location
        if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
          clearLoadingTimer()
          setError('Street View could not locate this address.')
          setLoading(false)
          return
        }

        setFallbackUrl(googleStreetViewUrl(address, location))
        setEmbedUrl(
          `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&location=${location.lat},${location.lng}&fov=90&heading=0&pitch=0`
        )
      })
      .catch((err) => {
        if (cancelled) return
        clearLoadingTimer()
        setError(err instanceof Error ? err.message : 'Street View failed to load.')
        setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
      clearLoadingTimer()
    }
  }, [address])

  return (
    <div className="relative" style={{ width: '100%', height }}>
      {embedUrl && !error ? (
        <iframe
          src={embedUrl}
          width="100%"
          height="100%"
          style={{ border: 0, display: 'block', height: '100%' }}
          allowFullScreen
          loading="eager"
          title="Street View"
          onLoad={() => {
            clearLoadingTimer()
            setLoading(false)
          }}
        />
      ) : (
        <div style={{ width: '100%', height }} />
      )}

      {(loading || error) && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm"
          style={{
            background: error ? 'rgba(0,0,0,0.72)' : 'transparent',
            color: error ? '#fff' : 'inherit',
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
            'Loading...'
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
