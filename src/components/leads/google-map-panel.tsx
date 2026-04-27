'use client'

import { useEffect, useRef, useState } from 'react'

const GMAPS_KEY = process.env.NEXT_PUBLIC_GMAPS_KEY ?? ''

declare global {
  interface Window {
    google?: typeof google
    __gmapsLoader?: Promise<typeof google>
  }
}

function loadMapsJs(): Promise<typeof google> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (window.google?.maps) return Promise.resolve(window.google)
  if (window.__gmapsLoader) return window.__gmapsLoader

  window.__gmapsLoader = new Promise((resolve, reject) => {
    const existing = document.getElementById('gmaps-js') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google!))
      existing.addEventListener('error', () => reject(new Error('Maps JS failed to load')))
      return
    }
    const s = document.createElement('script')
    s.id = 'gmaps-js'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&v=weekly&libraries=geometry`
    s.async = true
    s.defer = true
    s.onload = () => resolve(window.google!)
    s.onerror = () => reject(new Error('Maps JS failed to load'))
    document.head.appendChild(s)
  })
  return window.__gmapsLoader
}

interface PanelProps {
  address: string
  height?: number | string
}

export function StreetViewPanel({ address, height = 500 }: PanelProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoading(true)

    loadMapsJs()
      .then(g => {
        if (cancelled || !ref.current) return
        const geocoder = new g.maps.Geocoder()
        geocoder.geocode({ address }, (results, status) => {
          if (cancelled || !ref.current) return
          if (status !== 'OK' || !results?.[0]) {
            setError('Address could not be located.')
            setLoading(false)
            return
          }
          const loc = results[0].geometry.location
          const sv = new g.maps.StreetViewService()
          sv.getPanorama(
            { location: loc, radius: 80, source: g.maps.StreetViewSource.OUTDOOR },
            (data, svStatus) => {
              if (cancelled || !ref.current) return
              if (svStatus !== 'OK' || !data?.location?.pano) {
                setError('No Street View imagery here.')
                setLoading(false)
                return
              }
              new g.maps.StreetViewPanorama(ref.current, {
                pano: data.location.pano,
                pov: {
                  heading: g.maps.geometry.spherical.computeHeading(data.location.latLng!, loc),
                  pitch: 0,
                },
                zoom: 1,
                addressControl: false,
                fullscreenControl: true,
                motionTracking: false,
                motionTrackingControl: false,
              })
              setLoading(false)
            },
          )
        })
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load Street View.')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [address])

  return (
    <div className="relative" style={{ width: '100%', height }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      {(loading || error) && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none"
          style={{
            background: error ? 'rgba(0,0,0,0.6)' : 'transparent',
            color: error ? '#fff' : 'inherit',
          }}
        >
          {error ? error : 'Loading…'}
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
    setError(null)
    setLoading(true)

    loadMapsJs()
      .then(g => {
        if (cancelled || !ref.current) return
        const geocoder = new g.maps.Geocoder()
        geocoder.geocode({ address }, (results, status) => {
          if (cancelled || !ref.current) return
          if (status !== 'OK' || !results?.[0]) {
            setError('Address could not be located.')
            setLoading(false)
            return
          }
          const loc = results[0].geometry.location
          const map = new g.maps.Map(ref.current, {
            center: loc,
            zoom: 17,
            mapTypeId: 'hybrid',
            tilt: 0,
            streetViewControl: false,
            fullscreenControl: true,
          })
          new g.maps.Marker({ map, position: loc, title: address })
          setLoading(false)
        })
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load map.')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [address])

  return (
    <div className="relative" style={{ width: '100%', height }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      {(loading || error) && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none"
          style={{
            background: error ? 'rgba(0,0,0,0.6)' : 'transparent',
            color: error ? '#fff' : 'inherit',
          }}
        >
          {error ? error : 'Loading…'}
        </div>
      )}
    </div>
  )
}
