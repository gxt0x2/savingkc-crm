'use client'

import { useEffect, useId, useRef, useState } from 'react'

/**
 * Google Places-backed address input using the newer Autocomplete Data API.
 * Lazy-loads Maps on first focus so the LP still loads with a plain input.
 *
 * Falls back silently to a plain text input if the key, script, or Places
 * library is unavailable.
 */

type PlaceSuggestion = {
  placePrediction?: {
    text?: { text?: string }
    mainText?: { text?: string }
    secondaryText?: { text?: string }
  }
}

type PlacesLibrary = {
  AutocompleteSessionToken?: new () => unknown
  AutocompleteSuggestion?: {
    fetchAutocompleteSuggestions: (request: {
      input: string
      sessionToken?: unknown
      includedRegionCodes?: string[]
      locationBias?: {
        north: number
        south: number
        east: number
        west: number
      }
    }) => Promise<{ suggestions?: PlaceSuggestion[] }>
  }
}

type WindowWithPlaces = Window & {
  google?: {
    maps?: {
      importLibrary?: (library: 'places') => Promise<PlacesLibrary>
      places?: PlacesLibrary
    }
  }
  __skcGoogleMapsReady?: () => void
  __skcMapsLoading?: Promise<void>
  __skcMapsKey?: Promise<string>
  __skcPlacesLibrary?: Promise<PlacesLibrary>
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
  if (w.google?.maps?.importLibrary || w.google?.maps?.places) return Promise.resolve()
  if (w.__skcMapsLoading) return w.__skcMapsLoading
  w.__skcMapsLoading = new Promise<void>((resolve, reject) => {
    const callbackName = '__skcGoogleMapsReady'
    const timeout = window.setTimeout(() => reject(new Error('maps-load-timeout')), 7000)
    w.__skcGoogleMapsReady = () => {
      window.clearTimeout(timeout)
      resolve()
    }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async&v=weekly&callback=${callbackName}`
    script.async = true
    script.defer = true
    script.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error('maps-load-failed'))
    }
    document.head.appendChild(script)
  })
  return w.__skcMapsLoading
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function getPlacesLibrary(): Promise<PlacesLibrary> {
  const w = window as WindowWithPlaces
  if (w.__skcPlacesLibrary) return w.__skcPlacesLibrary

  w.__skcPlacesLibrary = getMapsKey()
    .then((apiKey) => loadGoogleMaps(apiKey))
    .then(async () => {
      if (w.google?.maps?.importLibrary) {
        const places = await w.google.maps.importLibrary('places')
        if (places.AutocompleteSuggestion) return places
      }
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (w.google?.maps?.places?.AutocompleteSuggestion) return w.google.maps.places
        await wait(100)
      }
      throw new Error('places-library-unavailable')
    })
  return w.__skcPlacesLibrary
}

function getSuggestionText(suggestion: PlaceSuggestion): string {
  const prediction = suggestion.placePrediction
  return (
    prediction?.text?.text ||
    [prediction?.mainText?.text, prediction?.secondaryText?.text].filter(Boolean).join(', ')
  )
}

export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder,
  id,
  autoComplete = 'street-address',
}: {
  value: string
  onChange: (v: string) => void
  onPlaceSelected?: (address: string) => void
  placeholder?: string
  id?: string
  autoComplete?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listboxId = useId()
  const requestIdRef = useRef(0)
  const sessionTokenRef = useRef<unknown | null>(null)
  const lastSelectedValueRef = useRef<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [placesAvailable, setPlacesAvailable] = useState(true)

  const handleFocus = () => {
    setFocused(true)
    getPlacesLibrary().catch(() => {
      // Keep the plain input usable; the search effect owns the final fallback.
    })
  }

  useEffect(() => {
    if (!focused || !placesAvailable) return

    const query = value.trim()
    if (query && query === lastSelectedValueRef.current) {
      setSuggestions([])
      setActiveIndex(-1)
      return
    }
    if (query.length < 4) {
      setSuggestions([])
      setActiveIndex(-1)
      return
    }

    const requestId = ++requestIdRef.current
    const timer = window.setTimeout(() => {
      setLoading(true)
      getPlacesLibrary()
        .then(async (places) => {
          const fetchSuggestions = places.AutocompleteSuggestion?.fetchAutocompleteSuggestions
          if (!fetchSuggestions) throw new Error('autocomplete-suggestion-unavailable')
          if (!sessionTokenRef.current && places.AutocompleteSessionToken) {
            sessionTokenRef.current = new places.AutocompleteSessionToken()
          }

          return fetchSuggestions({
            input: query,
            sessionToken: sessionTokenRef.current ?? undefined,
            includedRegionCodes: ['us'],
            // KC metro: bias to Jackson/Clay/Platte/Wyandotte/Johnson.
            locationBias: {
              north: 39.55,
              south: 38.7,
              east: -94.0,
              west: -95.05,
            },
          })
        })
        .then((result) => {
          if (requestId !== requestIdRef.current) return
          const nextSuggestions = (result.suggestions ?? []).filter((suggestion) => getSuggestionText(suggestion))
          setSuggestions(nextSuggestions)
          setActiveIndex(nextSuggestions.length > 0 ? 0 : -1)
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return
          setSuggestions([])
          setActiveIndex(-1)
          setPlacesAvailable(false)
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false)
        })
    }, 180)

    return () => window.clearTimeout(timer)
  }, [focused, placesAvailable, value])

  const selectSuggestion = (suggestion: PlaceSuggestion) => {
    const text = getSuggestionText(suggestion)
    if (!text) return
    lastSelectedValueRef.current = text
    onChange(text)
    onPlaceSelected?.(text)
    setSuggestions([])
    setActiveIndex(-1)
    sessionTokenRef.current = null
  }

  const hasSuggestions = suggestions.length > 0
  const listOpen = focused && (hasSuggestions || loading)

  return (
    <div className="address-autocomplete">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onFocus={handleFocus}
        onBlur={() => {
          window.setTimeout(() => {
            setFocused(false)
            setSuggestions([])
            setActiveIndex(-1)
          }, 150)
        }}
        onChange={(e) => {
          lastSelectedValueRef.current = null
          onChange(e.target.value)
        }}
        onKeyDown={(e) => {
          if (!hasSuggestions) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((index) => (index + 1) % suggestions.length)
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
          }
          if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault()
            selectSuggestion(suggestions[activeIndex])
          }
          if (e.key === 'Escape') {
            setSuggestions([])
            setActiveIndex(-1)
          }
        }}
      />
      {listOpen && (
        <div className="address-suggestions" id={listboxId} role="listbox">
          {loading && !hasSuggestions ? (
            <div className="address-suggestion muted">Searching addresses...</div>
          ) : suggestions.map((suggestion, index) => (
            <button
              key={`${getSuggestionText(suggestion)}-${index}`}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`address-suggestion ${index === activeIndex ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
            >
              <span className="material-symbols-outlined" aria-hidden>location_on</span>
              <span>{getSuggestionText(suggestion)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
