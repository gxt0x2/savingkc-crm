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

export function ForeclosureMap({ pins, heightClass = 'h-72' }: { pins: ForeclosureMapPin[]; heightClass?: string }) {
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
    <section aria-label="Foreclosure sale map" className="crm-panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <p className="text-xs font-black uppercase tracking-wide text-[var(--crm-text-muted)]">Sale map</p>
        <p className="text-xs font-bold text-[var(--crm-text-muted)]">{countLabel}</p>
      </div>
      {message ? <p className="px-4 pb-3 text-sm font-bold text-[var(--crm-text-muted)]">{message}</p> : null}
      <div ref={host} className={`${styles.host} ${heightClass} w-full`} />
    </section>
  )
}
