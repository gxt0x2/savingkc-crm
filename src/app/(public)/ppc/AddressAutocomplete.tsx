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

  // Load + attach Places on mount instead of on focus. The field is only
  // mounted when the user reaches step 3, so this is already late enough
  // to keep off LCP. Loading at focus left a typing-gap where the script
  // wasn't ready yet and users got no suggestions.
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GMAPS_KEY
    if (!apiKey) {
      // eslint-disable-next-line no-console
      console.warn('[AddressAutocomplete] NEXT_PUBLIC_GMAPS_KEY missing — autocomplete disabled')
      return
    }
    let cancelled = false
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || attached || !inputRef.current) return
        const w = window as WindowWithPlaces
        if (!w.google?.maps?.places) {
          // eslint-disable-next-line no-console
          console.warn('[AddressAutocomplete] places library missing on window.google.maps')
          return
        }
        const autocomplete = new w.google.maps.places.Autocomplete(inputRef.current, {
          // KC metro: bias to a box around Jackson/Clay/Platte/Wyandotte/Johnson
          bounds: { north: 39.55, south: 38.7, east: -94.0, west: -95.05 },
          componentRestrictions: { country: 'us' },
          fields: ['formatted_address', 'address_components'],
          types: ['address'],
        } as unknown as Record<string, unknown>)
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace()
          if (place?.formatted_address) onChange(place.formatted_address)
        })
        setAttached(true)
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[AddressAutocomplete] script load failed', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFocus = () => {
    // No-op — kept so the input's existing onFocus contract doesn't break.
  }

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
