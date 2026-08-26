'use client'

import { useState, useEffect, useCallback } from 'react'
import { trackEvent } from './track-events'
import { DealGalleryImage } from './deal-gallery-image'

interface PhotoGalleryProps {
  photos: string[]
  propertyAddress?: string
  city?: string
  state?: string
  zip?: string
  county?: string
  showAddress?: boolean
  slug?: string
}

const GMAPS_KEY = process.env.NEXT_PUBLIC_GMAPS_KEY ?? ''
const THUMB_STRIP_SIZE = 25
const GRID_THUMB_WIDTH = 360
const GRID_THUMB_QUALITY = 78
const QUIET_PRELOAD_DELAY_MS = 1400
const QUIET_PRELOAD_BATCH_SIZE = 8
const QUIET_PRELOAD_BATCH_DELAY_MS = 250
const warmedImageUrls = new Set<string>()

function isDealAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.hostname === 'fprrknfyzlthbxewnwmi.supabase.co' &&
      parsed.pathname.startsWith('/storage/v1/object/public/deal-assets/')
    )
  } catch {
    return false
  }
}

// Local proxy because Supabase image transformations are not enabled on this
// project. The proxy resizes/caches safely, and each <img> falls back to the
// original URL if the proxy ever fails.
function img(url: string, width: number, quality = 82): string {
  if (!url) return url
  if (!isDealAssetUrl(url)) return url
  return `/api/deals/image?src=${encodeURIComponent(url)}&w=${width}&q=${quality}`
}

// Hint a resource to start downloading before the JS handler runs.
function preloadImage(url: string) {
  if (typeof window === 'undefined') return
  const i = new Image()
  i.src = url
}

function preloadImagesQuietly(urls: string[]) {
  if (typeof window === 'undefined') return () => {}

  let index = 0
  let stopped = false
  let timer: number | undefined

  function warmNextBatch() {
    if (stopped) return

    let warmedThisBatch = 0
    while (index < urls.length && warmedThisBatch < QUIET_PRELOAD_BATCH_SIZE) {
      const url = urls[index]
      index += 1
      if (!url || warmedImageUrls.has(url)) continue
      warmedImageUrls.add(url)
      preloadImage(url)
      warmedThisBatch += 1
    }

    if (index < urls.length) {
      timer = window.setTimeout(warmNextBatch, QUIET_PRELOAD_BATCH_DELAY_MS)
    }
  }

  timer = window.setTimeout(warmNextBatch, QUIET_PRELOAD_DELAY_MS)

  return () => {
    stopped = true
    if (timer) window.clearTimeout(timer)
  }
}

/* ── Google-style filled SVG icons ── */

/* Google Street View pegman icon (Material Design "streetview") */
function IconPegman({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="4" r="2" />
      <path d="M12 7c-1.1 0-2 .9-2 2v5h1.5v6h3v-6H16V9c0-1.1-.9-2-2-2z" />
    </svg>
  )
}

/* Google Maps folded map with pin icon (multi-color) */
function IconGoogleMap({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none">
      <path d="M8 18l16-8v36l-16 8V18z" fill="#FBBC04" />
      <path d="M24 10l16 8v36l-16-8V10z" fill="#34A853" />
      <path d="M40 18l16-8v36l-16 8V18z" fill="#4285F4" />
      <path d="M32 6c-5.52 0-10 4.48-10 10 0 7.5 10 18 10 18s10-10.5 10-18c0-5.52-4.48-10-10-10z" fill="#EA4335" />
      <circle cx="32" cy="16" r="4" fill="white" />
    </svg>
  )
}

/* Google Maps pin icon (single color, for modals) */
function IconLocationPin({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
    </svg>
  )
}

export default function PhotoGallery({
  photos,
  propertyAddress,
  city,
  state,
  zip,
  showAddress = true,
  slug,
}: PhotoGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [gridView, setGridView] = useState(false)
  const [streetViewOpen, setStreetViewOpen] = useState(false)
  const [mapViewOpen, setMapViewOpen] = useState(false)
  const [streetViewEmbedUrl, setStreetViewEmbedUrl] = useState<string | null>(null)
  const [streetViewError, setStreetViewError] = useState<string | null>(null)
  const [streetStaticBroken, setStreetStaticBroken] = useState(false)
  const [mapStaticBroken, setMapStaticBroken] = useState(false)

  const fullAddress = [propertyAddress, city, state, zip].filter(Boolean).join(', ')
  const encodedAddress = encodeURIComponent(fullAddress)
  const hasAddress = showAddress && fullAddress.length > 0
  const hasGoogleMapsKey = GMAPS_KEY.trim().length > 0

  // Static map/streetview from Google. Sized 2x the rendered tile (~360px wide
  // displayed) for retina; scale=2 doubles density which is what makes them
  // visibly sharp without going full 800x400. Also preconnect at first render.
  const streetViewStaticUrl = hasAddress && hasGoogleMapsKey
    ? `https://maps.googleapis.com/maps/api/streetview?size=640x360&scale=2&location=${encodedAddress}&fov=90&pitch=5&key=${GMAPS_KEY}`
    : null

  const mapStaticUrl = hasAddress
    ? `/api/maps/static?address=${encodedAddress}&z=19&w=640&h=640`
    : null

  const mapModalStaticUrl = hasAddress
    ? `/api/maps/static?address=${encodedAddress}&z=19&w=640&h=500`
    : null

  const mapEmbedUrl = hasAddress && hasGoogleMapsKey
    ? `https://www.google.com/maps/embed/v1/place?key=${GMAPS_KEY}&q=${encodedAddress}&zoom=18&maptype=roadmap`
    : null

  const publicGoogleMapUrl = hasAddress
    ? `https://www.google.com/maps?q=${encodedAddress}&z=18&output=embed`
    : null

  const trackGalleryEvent = useCallback((eventType: string, metadata: Record<string, unknown>) => {
    if (!slug) return
    trackEvent(slug, eventType, {
      section: 'gallery',
      total_photos: photos.length,
      has_address: hasAddress,
      ...metadata,
    })
  }, [hasAddress, photos.length, slug])

  useEffect(() => {
    if (!hasAddress || typeof document === 'undefined') return
    // preconnect so the TLS + DNS handshake is done before <img> requests fire
    const hosts = ['https://maps.googleapis.com', 'https://maps.gstatic.com', 'https://www.google.com']
    const links: HTMLLinkElement[] = []
    hosts.forEach(href => {
      const l = document.createElement('link')
      l.rel = 'preconnect'
      l.href = href
      l.crossOrigin = ''
      document.head.appendChild(l)
      links.push(l)
    })
    return () => { links.forEach(l => l.remove()) }
  }, [hasAddress])

  /* ── Lightbox handlers ── */
  const openLightbox = useCallback((index: number) => {
    setCurrentIndex(index)
    setGridView(false)
    setLightboxOpen(true)
    trackGalleryEvent('photo_open', {
      item_id: `photo_${index + 1}`,
      item_label: `Photo ${index + 1}`,
      photo_index: index + 1,
      position: index + 1,
      view: 'lightbox',
    })
  }, [trackGalleryEvent])

  const openPhotoGrid = useCallback(() => {
    setGridView(true)
    setLightboxOpen(true)
    trackGalleryEvent('photo_open', {
      item_id: 'photo_grid',
      item_label: 'Show all photos',
      view: 'grid',
      total_photos: photos.length,
    })
  }, [photos.length, trackGalleryEvent])

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false)
  }, [])

  const goNext = useCallback(() => {
    setCurrentIndex(i => (i + 1) % photos.length)
  }, [photos.length])

  const goPrev = useCallback(() => {
    setCurrentIndex(i => (i - 1 + photos.length) % photos.length)
  }, [photos.length])

  // Preload next + prev photos when the lightbox is on a given frame, so
  // arrow nav feels instant.
  useEffect(() => {
    if (!lightboxOpen || gridView || photos.length <= 1) return
    const next = (currentIndex + 1) % photos.length
    const prev = (currentIndex - 1 + photos.length) % photos.length
    preloadImage(img(photos[next], 1800))
    preloadImage(img(photos[prev], 1800))
  }, [lightboxOpen, gridView, currentIndex, photos])

  // Warm the whole thumbnail gallery after the page has settled. This mimics
  // "quiet preload" behavior: the visible page wins first, then the likely next
  // interaction is prepared in small background batches.
  useEffect(() => {
    if (typeof window === 'undefined' || photos.length <= 4) return
    const urls = photos.map((url) => img(url, GRID_THUMB_WIDTH, GRID_THUMB_QUALITY))
    return preloadImagesQuietly(urls)
  }, [photos])

  // Keyboard navigation
  useEffect(() => {
    if (!lightboxOpen && !streetViewOpen && !mapViewOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (streetViewOpen) setStreetViewOpen(false)
        else if (mapViewOpen) setMapViewOpen(false)
        else closeLightbox()
      }
      if (lightboxOpen && !streetViewOpen && !mapViewOpen) {
        if (e.key === 'ArrowRight') goNext()
        if (e.key === 'ArrowLeft') goPrev()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [lightboxOpen, streetViewOpen, mapViewOpen, closeLightbox, goNext, goPrev])

  // Lock body scroll when any modal is open
  useEffect(() => {
    if (lightboxOpen || streetViewOpen || mapViewOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [lightboxOpen, streetViewOpen, mapViewOpen])

  /* ── Street View modal opener (geocode → embed URL) ──
     Needs Geocoding API + Maps Embed API enabled in Google Cloud
     Console. If either is missing/blocked we fall back to a clean
     "Open in Google Maps" link instead of dumping Google's raw
     error JSON into an iframe. */
  async function openStreetView() {
    setStreetViewOpen(true)
    trackGalleryEvent('street_view_open', {
      cta_id: 'deal_street_view',
      cta_label: 'Street View',
      destination: 'street_view_modal',
    })
    if (streetViewEmbedUrl || streetViewError) return
    if (!hasGoogleMapsKey) {
      setStreetViewError('Street View requires a Google Maps API key.')
      return
    }
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GMAPS_KEY}`
      )
      const data = await res.json()
      if (data.error_message || data.status === 'REQUEST_DENIED') {
        setStreetViewError(data.error_message || 'Geocoding is not enabled on this Google Cloud project.')
        return
      }
      const loc = data.results?.[0]?.geometry?.location
      if (loc) {
        setStreetViewEmbedUrl(
          `https://www.google.com/maps/embed/v1/streetview?key=${GMAPS_KEY}&location=${loc.lat},${loc.lng}&fov=90&heading=0&pitch=0`
        )
      } else {
        setStreetViewError('No street view available for this address.')
      }
    } catch (err) {
      setStreetViewError(err instanceof Error ? err.message : 'Could not load street view.')
    }
  }

  if (photos.length === 0) return null

  const showMapTiles = hasAddress && photos.length >= 4
  const remaining = photos.length - 4
  const thumbStripStart = Math.max(
    0,
    Math.min(currentIndex - Math.floor(THUMB_STRIP_SIZE / 2), photos.length - THUMB_STRIP_SIZE)
  )
  const thumbStripPhotos = photos.slice(thumbStripStart, thumbStripStart + THUMB_STRIP_SIZE)

  return (
    <>
      {/* ── Gallery Grid ── */}
      <div className="mb-6 relative">
        {photos.length === 1 ? (
          /* Single photo */
          <div className="relative h-[400px] rounded-xl overflow-hidden cursor-pointer" onClick={() => openLightbox(0)}>
            <DealGalleryImage
              src={img(photos[0], 1600, 84)}
              originalUrl={photos[0]}
              alt="Property"
              sizes="(max-width: 1024px) 100vw, 1200px"
              className="object-cover"
              fetchPriority="high"
            />
          </div>
        ) : photos.length === 2 ? (
          /* Two photos */
          <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden">
            {photos.slice(0, 2).map((url, i) => (
              <div key={i} className="relative h-[350px] cursor-pointer" onClick={() => openLightbox(i)}>
                <DealGalleryImage
                  src={img(url, 900)}
                  originalUrl={url}
                  alt={`Property ${i + 1}`}
                  sizes="(max-width: 1024px) 50vw, 600px"
                  className="object-cover"
                  fetchPriority={i === 0 ? 'high' : 'auto'}
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
              </div>
            ))}
          </div>
        ) : showMapTiles ? (
          /* ── InvestorLift-style grid with Street View + Map View ──
             Layout (4 cols × 2 rows):
             [Hero col1 row1-2] [Photo2 col2 row1] [StreetView col3-4 row1]
             [Hero continues  ] [MapView col2 row2] [Photo3 col3] [Photo4+more col4]
          */
          <div
            className="grid gap-1 rounded-xl overflow-hidden"
            style={{
              gridTemplateColumns: '45% 1fr 1fr 1fr',
              gridTemplateRows: '1fr 1fr',
              height: '420px',
            }}
          >
            {/* Hero — col 1, row 1-2 */}
            <div
              className="row-span-2 cursor-pointer relative group"
              onClick={() => openLightbox(0)}
            >
              <DealGalleryImage
                src={img(photos[0], 1600, 84)}
                originalUrl={photos[0]}
                alt="Property"
                sizes="(max-width: 1024px) 25vw, 320px"
                className="object-cover"
                fetchPriority="high"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            </div>

            {/* Photo 2 — col 2, row 1 */}
            <div
              className="cursor-pointer relative group"
              onClick={() => openLightbox(1)}
            >
              <DealGalleryImage
                src={img(photos[1], 900, 84)}
                originalUrl={photos[1]}
                alt="Property 2"
                sizes="(max-width: 1024px) 25vw, 320px"
                className="object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            </div>

            {/* Street View — col 3-4, row 1 */}
            <div
              className="col-span-2 cursor-pointer relative group overflow-hidden"
              onClick={openStreetView}
            >
              {streetViewStaticUrl && !streetStaticBroken ? (
                <DealGalleryImage
                  src={streetViewStaticUrl}
                  alt="Street View"
                  sizes="(max-width: 1024px) 50vw, 640px"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  fetchPriority="high"
                  onUnavailable={() => setStreetStaticBroken(true)}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#3a4a5a] via-[#2a3a4a] to-[#1a2a3a] flex items-center justify-center">
                  <IconPegman className="w-12 h-12 text-white/40" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/60 group-hover:from-black/40 group-hover:via-black/15 group-hover:to-black/40 transition-all pointer-events-none" />
              {/* Top-right badge */}
              <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/70 backdrop-blur-sm px-4 py-2 rounded-full border border-white/20">
                <IconPegman className="w-5 h-5 text-white" />
                <span className="text-white font-bold text-xs tracking-wider">STREET VIEW</span>
              </div>
            </div>

            {/* Map View — col 2, row 2 */}
            <div
              className="cursor-pointer relative group overflow-hidden bg-[#e8e4de]"
              onClick={() => {
                setMapViewOpen(true)
                trackGalleryEvent('map_view_open', {
                  cta_id: 'deal_map_view',
                  cta_label: 'Map View',
                  destination: 'map_modal',
                })
              }}
            >
              {mapStaticUrl && !mapStaticBroken ? (
                <>
                  <DealGalleryImage
                    src={mapStaticUrl}
                    alt="Map"
                    sizes="(max-width: 1024px) 25vw, 320px"
                    className="object-cover group-hover:brightness-95 transition-all"
                    fetchPriority="high"
                    onUnavailable={() => setMapStaticBroken(true)}
                  />
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm px-3 py-1 rounded-full border border-white/20">
                    <IconGoogleMap className="w-3.5 h-3.5" />
                    <span className="text-white font-bold text-[10px] tracking-wider">MAP VIEW</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="absolute inset-0 bg-[#ebe7df] group-hover:brightness-95 transition-all" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
                    <IconGoogleMap className="w-8 h-8 drop-shadow-md opacity-70" />
                    <span className="text-[#4b5563] font-bold text-[10px] tracking-wider">MAP UNAVAILABLE</span>
                    <span className="text-[#6b7280] text-[10px] leading-tight">Add Google Maps key</span>
                  </div>
                </>
              )}
            </div>

            {/* Photo 3 — col 3, row 2 */}
            <div
              className="cursor-pointer relative group"
              onClick={() => openLightbox(2)}
            >
              <DealGalleryImage
                src={img(photos[2], 800, 84)}
                originalUrl={photos[2]}
                alt="Property 3"
                sizes="(max-width: 1024px) 25vw, 320px"
                className="object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            </div>

            {/* Photo 4 + "X more" — col 4, row 2 */}
            <div
              className="cursor-pointer relative group"
              onClick={() => { if (remaining > 0) openPhotoGrid(); else openLightbox(3) }}
            >
              <DealGalleryImage
                src={img(photos[3], 800, 84)}
                originalUrl={photos[3]}
                alt="Property 4"
                sizes="(max-width: 1024px) 25vw, 320px"
                className="object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              {remaining > 0 && (
                <div className="absolute bottom-3 right-3 bg-white/95 backdrop-blur text-gray-900 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-md flex items-center gap-1.5 pointer-events-none">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                  {remaining} more
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Standard 2×2 grid (3+ photos, no address) */
          <div className="grid grid-cols-4 grid-rows-2 gap-1 rounded-xl overflow-hidden" style={{ height: '420px' }}>
            <div
              className="col-span-2 row-span-2 cursor-pointer relative group"
              onClick={() => openLightbox(0)}
            >
              <DealGalleryImage
                src={img(photos[0], 1600, 84)}
                originalUrl={photos[0]}
                alt="Property"
                sizes="(max-width: 1024px) 50vw, 640px"
                className="object-cover"
                fetchPriority="high"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            </div>
            {photos.slice(1, 5).map((url, i) => (
              <div
                key={i}
                className="col-span-1 row-span-1 cursor-pointer relative group"
                onClick={() => openLightbox(i + 1)}
              >
                <DealGalleryImage
                  src={img(url, 500)}
                  originalUrl={url}
                  alt={`Property ${i + 2}`}
                  sizes="(max-width: 1024px) 25vw, 320px"
                  className="object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              </div>
            ))}
            {photos.length > 5 && (
              <button
                onClick={openPhotoGrid}
                className="absolute bottom-4 right-4 bg-white/95 backdrop-blur text-gray-900 text-sm font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-white transition-colors flex items-center gap-2"
              >
                Show all {photos.length} photos
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Street View Modal ── */}
      {streetViewOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setStreetViewOpen(false)}
        >
          <div
            className="relative w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl bg-white"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2 min-w-0">
                <IconPegman className="w-5 h-5 text-gray-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Street View</p>
                  <p className="text-sm font-bold text-gray-900 truncate">{fullAddress}</p>
                </div>
              </div>
              <button
                onClick={() => setStreetViewOpen(false)}
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {streetViewEmbedUrl ? (
              <iframe
                src={streetViewEmbedUrl}
                width="100%"
                height="500"
                style={{ border: 0, display: 'block' }}
                allowFullScreen
                loading="lazy"
                title="Street View"
              />
            ) : streetViewError ? (
              <div className="flex flex-col items-center justify-center gap-3 h-[500px] bg-gray-50 px-8 text-center">
                <IconPegman className="w-10 h-10 text-gray-400" />
                <p className="text-sm font-semibold text-gray-700 max-w-md">
                  Inline Street View is not available right now.
                </p>
                <p className="text-xs text-gray-500 max-w-md">
                  Enable <span className="font-mono">Geocoding API</span> and <span className="font-mono">Maps Embed API</span> in Google Cloud Console to render it inline. In the meantime, open the location in Google Maps.
                </p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  Open in Google Maps
                </a>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[500px] text-sm text-gray-400 bg-gray-50">
                Loading…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Map View Modal ── */}
      {mapViewOpen && hasAddress && (mapModalStaticUrl || mapEmbedUrl || publicGoogleMapUrl) && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setMapViewOpen(false)}
        >
          <div
            className="relative w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl bg-white"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2 min-w-0">
                <IconLocationPin className="w-5 h-5 text-gray-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Map View</p>
                  <p className="text-sm font-bold text-gray-900 truncate">{fullAddress}</p>
                </div>
              </div>
              <button
                onClick={() => setMapViewOpen(false)}
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-500"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {mapEmbedUrl ? (
              <iframe
                src={mapEmbedUrl}
                width="100%"
                height="500"
                style={{ border: 0, display: 'block' }}
                allowFullScreen
                loading="lazy"
                title="Map View"
              />
            ) : mapModalStaticUrl ? (
              <DealGalleryImage
                src={mapModalStaticUrl}
                alt={`Map of ${fullAddress}`}
                width={640}
                height={500}
                sizes="(max-width: 768px) 100vw, 640px"
                className="block h-[500px] w-full object-contain bg-gray-100"
              />
            ) : publicGoogleMapUrl ? (
              <iframe
                src={publicGoogleMapUrl}
                width="100%"
                height="500"
                style={{ border: 0, display: 'block' }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Map View"
              />
            ) : null}
          </div>
        </div>
      )}

      {/* ── Lightbox Modal ── */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                {gridView ? `${photos.length} Photos` : `${currentIndex + 1} / ${photos.length}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setGridView(!gridView)
                }}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title={gridView ? 'Single view' : 'Grid view'}
              >
                {gridView ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                )}
              </button>
              <button
                onClick={closeLightbox}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {gridView ? (
            /* Grid View */
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-w-6xl mx-auto">
                {photos.map((url, i) => (
                  <div
                    key={i}
                    className="relative cursor-pointer aspect-[4/3] rounded-lg overflow-hidden bg-neutral-900"
                    onClick={() => { setCurrentIndex(i); setGridView(false) }}
                  >
                    <DealGalleryImage
                      src={img(url, GRID_THUMB_WIDTH, GRID_THUMB_QUALITY)}
                      originalUrl={url}
                      alt={`Photo ${i + 1}`}
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      className="object-cover hover:opacity-80 transition-opacity"
                      fetchPriority={i < 8 ? 'high' : 'low'}
                      loading={i < 8 ? 'eager' : 'lazy'}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Single View */
            <div className="flex-1 flex items-center justify-center relative px-16">
              <button
                onClick={goPrev}
                className="absolute left-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <DealGalleryImage
                src={img(photos[currentIndex], 2000, 86)}
                originalUrl={photos[currentIndex]}
                alt={`Photo ${currentIndex + 1}`}
                width={2000}
                height={1500}
                sizes="calc(100vw - 8rem)"
                className="h-auto w-auto max-h-[80vh] max-w-full object-contain rounded-lg"
                fetchPriority="high"
              />

              <button
                onClick={goNext}
                className="absolute right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* Bottom thumbnails strip */}
          {!gridView && photos.length > 1 && (
            <div className="px-4 py-3 overflow-x-auto">
              <div className="flex gap-2 justify-center">
                {thumbStripPhotos.map((url, offset) => {
                  const i = thumbStripStart + offset
                  return (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    className={`relative w-16 h-12 rounded-md overflow-hidden flex-shrink-0 transition-all ${
                      i === currentIndex ? 'ring-2 ring-white opacity-100' : 'opacity-50 hover:opacity-75'
                    }`}
                  >
                    <DealGalleryImage
                      src={img(url, 160)}
                      originalUrl={url}
                      alt=""
                      sizes="64px"
                      className="object-cover"
                      loading="lazy"
                    />
                  </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
