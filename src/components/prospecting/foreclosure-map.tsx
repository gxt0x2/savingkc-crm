'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { loadMapsJs } from '@/components/leads/google-map-panel'
import type { ForeclosureMapPin } from '@/lib/prospecting/foreclosure'
import styles from './foreclosure-map.module.css'

const KANSAS_CITY = { lat: 39.084, lng: -94.585 }

interface ClickableMarker {
  addListener(name: string, handler: () => void): void
  setMap(map: null): void
}

interface LatLngBoundsLike {
  extend(position: { lat: number; lng: number }): void
}

interface SaleMap {
  fitBounds(bounds: LatLngBoundsLike): void
}

interface SaleMaps {
  maps: {
    Map: new (element: HTMLElement, options: Record<string, unknown>) => SaleMap
    Marker: new (options: Record<string, unknown>) => ClickableMarker
    LatLngBounds: new () => LatLngBoundsLike
  }
}

export function ForeclosureMap({ pins, heightClass = 'h-72', quiet = false }: { pins: ForeclosureMapPin[]; heightClass?: string; quiet?: boolean }) {
  const router = useRouter()
  const host = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const pinKey = pins.map((pin) => `${pin.id}:${pin.longitude}:${pin.latitude}`).join('|')

  useEffect(() => {
    const container = host.current
    if (!container) return
    let cancelled = false
    const markers: ClickableMarker[] = []
    const current = pins
    void loadMapsJs()
      .then((google) => {
        if (cancelled || !host.current) return
        const maps = google as unknown as SaleMaps
        const first = current[0]
        const map = new maps.maps.Map(host.current, {
          center: first ? { lat: first.latitude, lng: first.longitude } : KANSAS_CITY,
          zoom: current.length === 1 ? 12 : 10,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        })
        const bounds = new maps.maps.LatLngBounds()
        for (const pin of current) {
          const position = { lat: pin.latitude, lng: pin.longitude }
          const marker = new maps.maps.Marker({ position, map, title: `Open ${pin.ownerName}` })
          marker.addListener('click', () => { router.push(`/prospecting/foreclosure/${pin.id}`) })
          markers.push(marker)
          bounds.extend(position)
        }
        if (current.length > 1) map.fitBounds(bounds)
        setMessage(null)
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Google Maps could not be loaded.')
      })
    return () => {
      cancelled = true
      for (const marker of markers) marker.setMap(null)
    }
  }, [pinKey, pins, router])

  const countLabel = pins.length === 0 ? 'No coordinates in this queue' : `${pins.length} pin${pins.length === 1 ? '' : 's'}`
  return (
    <section aria-label="Foreclosure sale map" className={quiet ? 'fc-map-quiet' : 'crm-panel overflow-hidden rounded-2xl'}>
      {quiet ? null : <div className="flex items-center justify-between gap-3 px-4 py-2">
        <p className="text-xs font-black uppercase tracking-wide text-[var(--crm-text-muted)]">Sale map</p>
        <p className="text-xs font-bold text-[var(--crm-text-muted)]">{countLabel}</p>
      </div>}
      {message ? <p className="px-4 pb-3 text-sm font-bold text-[var(--crm-text-muted)]">{message}</p> : null}
      <div ref={host} className={`${styles.host} ${heightClass} w-full`} />
    </section>
  )
}

export function ForeclosureStreetView(props: {
  address: string
  latitude: number | null
  longitude: number | null
}) {
  return <StreetViewBody key={`${props.latitude ?? ''}:${props.longitude ?? ''}:${props.address}`} {...props} />
}

function StreetViewBody({
  address,
  latitude,
  longitude,
}: {
  address: string
  latitude: number | null
  longitude: number | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const [pano, setPano] = useState<'pending' | 'ready' | 'none'>(latitude == null || longitude == null ? 'none' : 'pending')
  const tryHref = latitude != null && longitude != null
    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latitude},${longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

  useEffect(() => {
    if (latitude == null || longitude == null) return
    let cancelled = false
    void loadMapsJs()
      .then((google) => {
        if (cancelled || !host.current) return
        const maps = google as unknown as {
          maps: {
            StreetViewService?: new () => {
              getPanorama: (
                request: { location: { lat: number; lng: number }; radius: number },
                callback: (data: { location?: { pano?: string } } | null, status: string) => void,
              ) => void
            }
            StreetViewPanorama?: new (element: HTMLElement, options: Record<string, unknown>) => void
          }
        }
        if (!maps.maps.StreetViewService || !maps.maps.StreetViewPanorama || !host.current) {
          setPano('none')
          return
        }
        const canvas = host.current
        const service = new maps.maps.StreetViewService()
        service.getPanorama({ location: { lat: latitude, lng: longitude }, radius: 80 }, (data, status) => {
          if (cancelled) return
          if (status !== 'OK' || !data?.location?.pano) {
            setPano('none')
            return
          }
          new maps.maps.StreetViewPanorama!(canvas, {
            pano: data.location.pano,
            visible: true,
            addressControl: false,
            fullscreenControl: true,
          })
          setPano('ready')
        })
      })
      .catch(() => { if (!cancelled) setPano('none') })
    return () => { cancelled = true }
  }, [latitude, longitude])

  return (
    <div className="fc-street">
      <div ref={host} className={`${styles.host} fc-map-canvas w-full`} hidden={pano !== 'ready'} />
      {pano === 'ready' ? null : (
        <div className="fc-street-empty">
          <p>{pano === 'pending' ? 'Checking Street View…' : 'Street View is not available for this location'}</p>
          <a href={tryHref} target="_blank" rel="noreferrer">Try on Google Maps</a>
        </div>
      )}
    </div>
  )
}
