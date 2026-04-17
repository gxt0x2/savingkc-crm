'use client'

import { useState } from 'react'
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
  detailsExpanded?: boolean
  onToggleDetails?: () => void
  arv?: number | null
  zestimate?: number | null
  onNotesClick?: () => void
}

function getCountyUrl(county: string | undefined, city: string | undefined, address: string): string {
  if (county) {
    if (county.toLowerCase().includes('jackson')) {
      return `https://www.jacksongov.org/services/property-tax/search?q=${encodeURIComponent(address)}`
    }
    if (county.toLowerCase().includes('wyandotte') || (city && city.toLowerCase().includes('kansas city, ks'))) {
      return 'https://www.wycokck.org/departments/county-appraiser'
    }
  }
  if (city && city.toLowerCase().includes('kansas city, ks')) {
    return 'https://www.wycokck.org/departments/county-appraiser'
  }
  return `https://www.google.com/search?q=${encodeURIComponent(address + ' county records parcel')}`
}

export function PropertyHero({ property, detailsExpanded, onToggleDetails, arv, zestimate, onNotesClick }: PropertyHeroProps) {
  const fullAddress = [property.address, property.city, property.state, property.zip]
    .filter(Boolean)
    .join(', ')
  const encodedAddress = encodeURIComponent(fullAddress || property.address)
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`
  const zillowUrl = `https://www.zillow.com/homes/${encodeURIComponent(fullAddress || property.address)}`
  const countyUrl = getCountyUrl(property.county, property.city, fullAddress || property.address)
  const GMAPS_KEY = 'AIzaSyB0_wshDWSFFVuEiuUmhslBYcpWG3ooLPc'
  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x320&location=${encodedAddress}&fov=90&pitch=5&key=${GMAPS_KEY}`
  const [showStreetView, setShowStreetView] = useState(false)
  const [streetViewEmbedUrl, setStreetViewEmbedUrl] = useState<string | null>(null)

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

  return (
    <div className="space-y-4">
      {/* Street View Modal */}
      {showStreetView && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowStreetView(false)}
        >
          <div
            className="relative w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setShowStreetView(false)}
              className="absolute top-3 right-3 z-10 bg-black/60 text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              <Icon name="close" />
            </button>
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
              <div className="flex items-center justify-center h-[500px] bg-slate-900 text-slate-400 text-sm">
                Loading…
              </div>
            )}
          </div>
        </div>
      )}

      {/* Street View Header — click to open inline Street View modal */}
      <div className="relative rounded-2xl overflow-hidden shadow-sm bg-slate-800">
        <button
          onClick={openStreetView}
          className="w-full block cursor-pointer"
          title="Click to open Street View"
          style={{ padding: 0, border: 'none', background: 'none' }}
        >
          <img
            src={streetViewUrl}
            alt={`Street view of ${fullAddress || property.address}`}
            width="100%"
            style={{ display: 'block', width: '100%', height: '200px', objectFit: 'cover' }}
            loading="lazy"
          />
        </button>
        {/* Address overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none px-4 pb-3 pt-8">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {property.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-secondary text-[10px] font-black uppercase rounded text-white"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="text-white font-bold text-sm">{fullAddress || property.address}</p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="flex gap-3">
        {/* Zestimate Display */}
        <div className="flex-1 bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex items-center justify-center gap-2">
          <span className="text-sm text-on-surface-variant font-medium">Zestimate:</span>
          {zestimate ? (
            <>
              <span className="text-lg font-bold text-primary">${zestimate.toLocaleString()}</span>
              <a
                href={zillowUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                via Zillow <Icon name="open_in_new" size="text-xs" />
              </a>
            </>
          ) : (
            <span className="text-lg font-bold text-on-surface-variant">—</span>
          )}
        </div>
        <a
          href={countyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex items-center justify-center gap-2 text-sm font-bold text-primary hover:bg-surface-container-low transition-all"
        >
          <Icon name="description" className="text-blue-600" /> County Records
        </a>
        <button
          onClick={onNotesClick}
          className="flex-1 bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex items-center justify-center gap-2 text-sm font-bold text-primary hover:bg-surface-container-low transition-all"
        >
          <Icon name="edit_note" className="text-blue-600" /> Notes
        </button>
      </div>

      {/* Property Summary Row — click to expand */}
      <button
        onClick={onToggleDetails}
        className="w-full grid grid-cols-4 gap-3 group"
        title={detailsExpanded ? 'Collapse property details' : 'Expand property details'}
      >
        <div className="bg-surface-container-low p-4 rounded-xl text-left">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Beds/Baths</p>
          <p className="text-xl font-black text-primary">
            {property.beds || '—'} / {property.baths || '—'}
          </p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-xl text-left">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Total SF</p>
          <p className="text-xl font-black text-primary">
            {property.sqft ? property.sqft.toLocaleString() : '—'}
          </p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-xl text-left">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Built</p>
          <p className="text-xl font-black text-primary">{property.yearBuilt || '—'}</p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-xl text-left relative">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Lot Size</p>
          <p className="text-xl font-black text-primary">
            {property.lotSize && property.lotSize !== '—' ? (
              <>{property.lotSize} <span className="text-xs font-medium opacity-60">AC</span></>
            ) : '—'}
          </p>
          {/* Chevron indicator */}
          <span className="absolute top-2 right-2 text-on-surface-variant group-hover:text-primary transition-colors">
            <Icon name={detailsExpanded ? 'expand_less' : 'expand_more'} size="text-base" />
          </span>
        </div>
      </button>
    </div>
  )
}
