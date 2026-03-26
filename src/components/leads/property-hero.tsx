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
}

const COUNTY_URLS: Record<string, string> = {
  jackson: 'https://www.jacksongov.org/residents/assessment',
  clay: 'https://www.claycountymo.gov/assessor',
  platte: 'https://www.platteassessor.org',
  wyandotte: 'https://www.wycokck.org/appraiser',
  johnson: 'https://www.jocogov.org/appraiser',
}

function getCountyUrl(county: string | undefined): string {
  if (!county) return 'https://www.jacksongov.org/residents/assessment'
  const key = county.toLowerCase().replace(/\s*county\s*/i, '').trim()
  return COUNTY_URLS[key] || 'https://www.jacksongov.org/residents/assessment'
}

export function PropertyHero({ property }: PropertyHeroProps) {
  const fullAddress = [property.address, property.city, property.state, property.zip]
    .filter(Boolean)
    .join(', ')
  const encodedAddress = encodeURIComponent(fullAddress || property.address)
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`
  const redfinUrl = `https://www.redfin.com/query?q=${encodedAddress}`
  const countyUrl = getCountyUrl(property.county)

  return (
    <div className="space-y-4">
      {/* Street View Hero — links to Google Maps */}
      <div className="relative h-80 rounded-2xl overflow-hidden shadow-sm bg-slate-800">
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 group"
          title="Open Street View on Google Maps"
        >
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
            <Icon name="location_on" className="text-white !text-3xl" />
          </div>
          <span className="text-white/80 text-sm font-semibold group-hover:text-white transition-colors">
            View on Google Maps ↗
          </span>
          <span className="text-white/50 text-xs px-4 text-center">{fullAddress || property.address}</span>
        </a>
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
        <div className="absolute bottom-6 left-6 text-white pointer-events-none">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {property.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-secondary text-[10px] font-black uppercase rounded text-white"
              >
                {tag}
              </span>
            ))}
          </div>
          <h3 className="text-2xl font-bold">{property.address}</h3>
        </div>
      </div>

      {/* Property Details Bento Grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-surface-container-low p-4 rounded-xl">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Beds/Baths</p>
          <p className="text-xl font-black text-primary">
            {property.beds || '—'} / {property.baths || '—'}
          </p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-xl">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Total SF</p>
          <p className="text-xl font-black text-primary">
            {property.sqft ? property.sqft.toLocaleString() : '—'}
          </p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-xl">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Built</p>
          <p className="text-xl font-black text-primary">{property.yearBuilt || '—'}</p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-xl">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Lot Size</p>
          <p className="text-xl font-black text-primary">
            {property.lotSize && property.lotSize !== '—' ? (
              <>{property.lotSize} <span className="text-xs font-medium opacity-60">AC</span></>
            ) : '—'}
          </p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="flex gap-4">
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
    </div>
  )
}
