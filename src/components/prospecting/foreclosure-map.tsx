'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { ForeclosureMapPin } from '@/lib/prospecting/foreclosure'
import 'leaflet/dist/leaflet.css'
import styles from './foreclosure-map.module.css'

const TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const KANSAS_CITY: [number, number] = [39.084, -94.585]

export function ForeclosureMap({ pins, heightClass = 'h-72' }: { pins: ForeclosureMapPin[]; heightClass?: string }) {
  const router = useRouter()
  const host = useRef<HTMLDivElement>(null)
  const pinsRef = useRef(pins)
  pinsRef.current = pins
  const pinKey = pins.map((pin) => `${pin.id}:${pin.longitude}:${pin.latitude}`).join('|')

  useEffect(() => {
    const container = host.current
    if (!container) return
    const currentPins = pinsRef.current
    let map: { remove: () => void } | null = null
    let cancelled = false
    void import('leaflet').then((leaflet) => {
      if (cancelled || !host.current) return
      const first = currentPins[0]
      const next = leaflet.map(host.current, { zoomControl: true })
      next.setView(first ? [first.latitude, first.longitude] : KANSAS_CITY, currentPins.length === 1 ? 12 : 10)
      leaflet.tileLayer(TILES, {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      }).addTo(next)
      for (const pin of currentPins) {
        const icon = leaflet.divIcon({
          className: styles.pin,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        })
        leaflet.marker([pin.latitude, pin.longitude], { icon, keyboard: true, title: `Open ${pin.ownerName}` })
          .on('click', () => { router.push(`/prospecting/foreclosure/${pin.id}`) })
          .addTo(next)
      }
      if (currentPins.length > 1) {
        next.fitBounds(leaflet.latLngBounds(currentPins.map((pin) => [pin.latitude, pin.longitude])), { padding: [48, 48], maxZoom: 13 })
      }
      window.setTimeout(() => next.invalidateSize(), 0)
      map = next
    }).catch(() => undefined)
    return () => {
      cancelled = true
      map?.remove()
    }
  }, [pinKey, router])

  const countLabel = pins.length === 0 ? 'No coordinates in this queue' : `${pins.length} pin${pins.length === 1 ? '' : 's'}`
  return (
    <section aria-label="Foreclosure sale map" className="crm-panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <p className="text-xs font-black uppercase tracking-wide text-[var(--crm-text-muted)]">Sale map</p>
        <p className="text-xs font-bold text-[var(--crm-text-muted)]">{countLabel}</p>
      </div>
      <div ref={host} className={`${styles.host} ${heightClass} w-full`} />
    </section>
  )
}
