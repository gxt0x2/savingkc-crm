import { Icon } from '@/components/ui/icon'

interface PropertyDetails {
  address: string
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

export function PropertyHero({ property }: PropertyHeroProps) {
  return (
    <div className="space-y-4">
      {/* Hero Image Placeholder */}
      <div className="relative h-80 rounded-2xl overflow-hidden shadow-sm bg-surface-container-highest">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <Icon name="home" className="text-outline/40 !text-6xl" />
            <p className="text-sm text-outline/60 mt-2">Street View</p>
          </div>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute bottom-6 left-6 text-white">
          <div className="flex items-center gap-2 mb-2">
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
            {property.beds} / {property.baths}
          </p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-xl">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Total SF</p>
          <p className="text-xl font-black text-primary">
            {property.sqft.toLocaleString()}
          </p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-xl">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Built</p>
          <p className="text-xl font-black text-primary">{property.yearBuilt}</p>
        </div>
        <div className="bg-surface-container-low p-4 rounded-xl">
          <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Lot Size</p>
          <p className="text-xl font-black text-primary">
            {property.lotSize} <span className="text-xs font-medium opacity-60">AC</span>
          </p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="flex gap-4">
        <a
          href="#"
          className="flex-1 bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex items-center justify-center gap-2 text-sm font-bold text-primary hover:bg-surface-container-low transition-all"
        >
          <Icon name="open_in_new" className="text-red-600" /> Redfin
        </a>
        <a
          href="#"
          className="flex-1 bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-lg flex items-center justify-center gap-2 text-sm font-bold text-primary hover:bg-surface-container-low transition-all"
        >
          <Icon name="description" className="text-blue-600" /> County Records
        </a>
      </div>
    </div>
  )
}
