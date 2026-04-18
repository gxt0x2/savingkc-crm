'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/icon'

interface PropertyDetails {
  address: string
  city?: string
  state?: string
  zip?: string
  county?: string
  beds: number
  baths: number
  sqft: number
  yearBuilt: number
  lotSize: string
  tags: string[]
}

interface PropertyHeroProps {
  property: PropertyDetails
  /** Zillow zestimate */
  zestimate?: number | null
  /** Redfin estimate */
  redfinEstimate?: number | null
  /** County/tax-assessed value */
  assessedValue?: number | null
  /** Show a shimmer placeholder while estimate enrichment is running. */
  estimateLoading?: boolean
  /** Called when user double-clicks the stats row (beds/baths/sqft/built). Opens the property-details modal. */
  onOpenDetails?: () => void
  /** @deprecated retained for compat */
  detailsExpanded?: boolean
  /** @deprecated retained for compat */
  onToggleDetails?: () => void
  /** @deprecated Notes row removed; kept to avoid breaking parent prop. */
  onNotesClick?: () => void
  /** @deprecated Replaced by explicit zestimate + assessedValue props. */
  zestimateLabel?: string
  /** @deprecated ARV now shown in Net Proceeds card. */
  arv?: number | null
}

function compactDollars(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n.toLocaleString()}`
}

export function PropertyHero({
  property,
  zestimate,
  redfinEstimate,
  assessedValue,
  estimateLoading,
  onOpenDetails,
}: PropertyHeroProps) {
  const fullAddress = [property.address, property.city, property.state, property.zip]
    .filter(Boolean)
    .join(', ')
  const encodedAddress = encodeURIComponent(fullAddress || property.address)
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`
  const zillowUrl = `https://www.zillow.com/homes/${encodeURIComponent(fullAddress || property.address)}`
  const GMAPS_KEY = 'AIzaSyB0_wshDWSFFVuEiuUmhslBYcpWG3ooLPc'
  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x320&location=${encodedAddress}&fov=90&pitch=5&key=${GMAPS_KEY}`
  const [showStreetView, setShowStreetView] = useState(false)
  const [streetViewEmbedUrl, setStreetViewEmbedUrl] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  async function openStreetView() {
    setShowStreetView(true)
    if (streetViewEmbedUrl) return
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GMAPS_KEY}`
      )
      const data = await res.json()
      const loc = data.results?.[0]?.geometry?.location
      if (loc) {
        setStreetViewEmbedUrl(
          `https://www.google.com/maps/embed/v1/streetview?key=${GMAPS_KEY}&location=${loc.lat},${loc.lng}&fov=90&heading=0&pitch=0`
        )
      } else {
        setStreetViewEmbedUrl(
          `https://www.google.com/maps/embed/v1/place?key=${GMAPS_KEY}&q=${encodedAddress}`
        )
      }
    } catch {
      setStreetViewEmbedUrl(
        `https://www.google.com/maps/embed/v1/place?key=${GMAPS_KEY}&q=${encodedAddress}`
      )
    }
  }

  const streetViewModal = showStreetView && (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
      onClick={() => setShowStreetView(false)}
    >
      <div
        className="relative w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl border"
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'var(--ck-border)' }}
        >
          <div className="min-w-0 flex items-center gap-2">
            <Icon name="360" className="!text-base !text-[color:var(--ck-accent)]" />
            <div className="min-w-0">
              <p className="ck-microlabel !text-[10px]">Street View</p>
              <p className="text-sm font-bold text-white truncate">
                {fullAddress || property.address}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowStreetView(false)}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text)' }}
            title="Close"
          >
            <Icon name="close" className="!text-base" />
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
        ) : (
          <div
            className="flex items-center justify-center h-[500px] text-sm"
            style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text-muted)' }}
          >
            Loading…
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {mounted && streetViewModal && createPortal(streetViewModal, document.body)}

      {/* ── Hero card: property image + PRIMARY ASSET overlay + address / estimate row ── */}
      <div
        className="rounded-2xl overflow-hidden border"
        style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
      >
        <button
          onClick={openStreetView}
          className="relative w-full block cursor-pointer group"
          title="Click to open Street View"
          style={{ padding: 0, border: 'none', background: 'none' }}
        >
          <img
            src={streetViewUrl}
            alt={`Street view of ${fullAddress || property.address}`}
            className="block w-full h-[220px] sm:h-[260px] object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            loading="lazy"
          />
          {/* subtle vignette */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none" />
          {/* top-left: tags */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 flex-wrap">
            {property.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-black/60 backdrop-blur-sm text-[10px] font-black uppercase tracking-wider rounded text-white border border-white/10"
              >
                {tag}
              </span>
            ))}
          </div>
          {/* top-right: street-view hint icon */}
          <div className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white/80 group-hover:text-white group-hover:bg-black/80 transition-colors">
            <Icon name="360" size="text-sm" />
          </div>
        </button>

        {/* Address + estimate row */}
        <div className="px-5 pt-4 pb-5 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="ck-microlabel mb-1.5">Primary Asset</p>
            <p className="text-xl sm:text-2xl font-black text-white leading-tight tracking-tight break-words">
              {property.address}
            </p>
            <p className="text-xs text-[color:var(--ck-text-muted)] mt-1">
              {[property.city, property.state, property.zip].filter(Boolean).join(', ')}
            </p>
            <div
              onDoubleClick={onOpenDetails}
              onClick={onOpenDetails}
              title="Click to view full property details"
              className="mt-3 inline-flex items-center gap-3 flex-wrap text-xs text-[color:var(--ck-text-muted)] cursor-pointer select-none px-1.5 -mx-1.5 py-1 rounded hover:bg-white/5 transition-colors"
            >
              <span className="font-semibold">
                <span className="text-white">{property.beds || '—'}</span>B /{' '}
                <span className="text-white">{property.baths || '—'}</span>B
              </span>
              <span className="text-[color:var(--ck-text-dim)]">·</span>
              <span className="font-semibold">
                <span className="text-white">
                  {property.sqft ? property.sqft.toLocaleString() : '—'}
                </span>{' '}
                SF
              </span>
              {property.yearBuilt ? (
                <>
                  <span className="text-[color:var(--ck-text-dim)]">·</span>
                  <span className="font-semibold">
                    Built <span className="text-white">{property.yearBuilt}</span>
                  </span>
                </>
              ) : null}
              <Icon
                name="info"
                className="!text-[11px] !text-[color:var(--ck-text-dim)] ml-1"
              />
            </div>
          </div>
          <div className="text-right shrink-0 min-w-[96px]">
            <p
              className="ck-microlabel mb-0.5"
              style={{ color: 'var(--ck-accent)' }}
            >
              Assessed
            </p>
            {assessedValue ? (
              <span
                className="block text-xl sm:text-2xl font-black tracking-tight leading-none"
                style={{ color: 'var(--ck-accent-bright)' }}
                title={`$${assessedValue.toLocaleString()}`}
              >
                {compactDollars(assessedValue)}
              </span>
            ) : (
              <span
                className="block text-xl sm:text-2xl font-black tracking-tight leading-none"
                style={{ color: 'var(--ck-text-dim)' }}
              >
                —
              </span>
            )}

            {property.lotSize && property.lotSize !== '--' && property.lotSize !== '—' ? (
              <p className="text-[10px] text-[color:var(--ck-text-muted)] mt-2 font-medium">
                {property.lotSize} AC lot
              </p>
            ) : null}
          </div>
        </div>
      </div>

    </div>
  )
}
