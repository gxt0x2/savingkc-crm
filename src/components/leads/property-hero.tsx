'use client'

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

export function PropertyHero({ property, detailsExpanded, onToggleDetails }: PropertyHeroProps) {
  const fullAddress = [property.address, property.city, property.state, property.zip]
    .filter(Boolean)
    .join(', ')
  const encodedAddress = encodeURIComponent(fullAddress || property.address)
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`
  const redfinUrl = `https://www.redfin.com/search#q=${encodeURIComponent(fullAddress || property.address)}`
  const countyUrl = getCountyUrl(property.county, property.city, fullAddress || property.address)
  const mapEmbedUrl = `https://www.google.com/maps?q=${encodedAddress}&output=embed`

  return (
    <div className="space-y-4">
      {/* Map Embed Header */}
      <div className="relative rounded-2xl overflow-hidden shadow-sm bg-slate-800">
        <iframe
          src={mapEmbedUrl}
          width="100%"
          height="200"
          style={{ border: 0, display: 'block' }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Property location map"
        />
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
        <a
          href={redfinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex items-center justify-center gap-2 text-sm font-bold text-primary hover:bg-surface-container-low transition-all"
        >
          <Icon name="open_in_new" className="text-red-600" /> Redfin
        </a>
        <a
          href={countyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex items-center justify-center gap-2 text-sm font-bold text-primary hover:bg-surface-container-low transition-all"
        >
          <Icon name="description" className="text-blue-600" /> County Records
        </a>
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex items-center justify-center gap-2 text-sm font-bold text-primary hover:bg-surface-container-low transition-all"
        >
          <Icon name="map" className="text-green-600" /> Maps
        </a>
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
