'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Google Places-backed address input. Lazy-loads the Maps JS API on first
 * focus so we don't tax LCP — the LP loads with a plain <input> and the
 * autocomplete attaches once the user is actually typing.
 *
 * Uses NEXT_PUBLIC_GMAPS_KEY (already configured for the CRM's other Maps
 * usage). Falls back silently to a plain text input if the key is missing
 * or the script fails to load.
 */

interface PlacesAutocomplete {
  addListener(event: string, cb: () => void): void
  getPlace(): {
    formatted_address?: string
    address_components?: Array<{ long_name: string; short_name: string; types: string[] }>
  }
}

type WindowWithPlaces = Window & {
  google?: { maps?: { places?: { Autocomplete: new (input: HTMLInputElement, opts?: Record<string, unknown>) => PlacesAutocomplete } } }
  __skcMapsLoading?: Promise<void>
  __skcMapsKey?: Promise<string>
}

function getBuildTimeMapsKey(): string {
  return (
    process.env.NEXT_PUBLIC_GMAPS_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ''
  ).trim()
}

function getMapsKey(): Promise<string> {
  if (typeof window === 'undefined') return Promise.reject(new Error('ssr'))
  const buildTimeKey = getBuildTimeMapsKey()
  if (buildTimeKey) return Promise.resolve(buildTimeKey)

  const w = window as WindowWithPlaces
  if (w.__skcMapsKey) return w.__skcMapsKey
  w.__skcMapsKey = fetch('/api/google-maps-key', { cache: 'force-cache' })
    .then((res) => {
      if (!res.ok) throw new Error('maps-key-unavailable')
      return res.json() as Promise<{ key?: string }>
    })
    .then((data) => {
      if (!data.key) throw new Error('maps-key-missing')
      return data.key
    })
  return w.__skcMapsKey
}

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('ssr'))
  const w = window as WindowWithPlaces
  if (w.google?.maps?.places) return Promise.resolve()
  if (w.__skcMapsLoading) return w.__skcMapsLoading
  w.__skcMapsLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async&v=weekly`
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('maps-load-failed'))
    document.head.appendChild(script)
  })
  return w.__skcMapsLoading
}

export function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  id,
  autoComplete = 'street-address',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  id?: string
  autoComplete?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [attached, setAttached] = useState(false)

  const handleFocus = () => {
    if (attached) return
    if (!inputRef.current) return
    getMapsKey()
      .then((apiKey) => loadGoogleMaps(apiKey))
      .then(() => {
        const w = window as WindowWithPlaces
        if (!inputRef.current || !w.google?.maps?.places) return
        const autocomplete = new w.google.maps.places.Autocomplete(inputRef.current, {
          // KC metro: bias to a box around Jackson/Clay/Platte/Wyandotte/Johnson
          bounds: {
            north: 39.55,
            south: 38.7,
            east: -94.0,
            west: -95.05,
          },
          componentRestrictions: { country: 'us' },
          fields: ['formatted_address', 'address_components'],
          strictBounds: false,
          types: ['address'],
        } as unknown as Record<string, unknown>)
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace()
          if (place?.formatted_address) onChange(place.formatted_address)
        })
        setAttached(true)
      })
      .catch(() => {
        // silently fall back to plain input
      })
  }

  useEffect(() => {
    // Prevent the browser from autofilling the field with a credit-card
    // street-address contact while Places is mounted — Chrome will sometimes
    // overlay both. Setting autocomplete on the input is enough for most
    // browsers; Places gets attached on focus.
  }, [])

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      placeholder={placeholder}
      autoComplete={autoComplete}
      value={value}
      onFocus={handleFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
