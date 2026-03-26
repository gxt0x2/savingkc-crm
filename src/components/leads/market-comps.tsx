// DML-02: Enhanced Comp Analysis Section
// Night 4 Phase 1: Property Dossier

import { Icon } from '@/components/ui/icon'
import { useState } from 'react'

interface CompProperty {
  id: string
  address: string
  status: string
  distance: string
  price: number
  sale_date?: string
  beds?: number
  baths?: number
  sqft?: number
  price_per_sqft?: number
  source?: 'mls' | 'county' | 'manual'
}

interface MarketCompsProps {
  comps: CompProperty[]
  totalComps: number
  onAddManualComp?: (comp: Partial<CompProperty>) => void
}

export function MarketComps({ comps, totalComps, onAddManualComp }: MarketCompsProps) {
  const [showAddForm, setShowAddForm] = useState(false)

  // Calculate comp statistics
  const compsWithSqft = comps.filter(c => c.sqft && c.price)
  const avgPricePerSqft = compsWithSqft.length > 0
    ? compsWithSqft.reduce((sum, c) => sum + (c.price / c.sqft!), 0) / compsWithSqft.length
    : 0

  const avgPrice = comps.length > 0
    ? comps.reduce((sum, c) => sum + c.price, 0) / comps.length
    : 0

  // ARV range suggestion (avg +/- 10%)
  const arvLow = Math.floor(avgPrice * 0.9)
  const arvHigh = Math.floor(avgPrice * 1.1)

  return (
    <section className="bg-surface-container-low rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">
          Market Comps
        </h2>
        {onAddManualComp && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-primary hover:text-secondary transition-colors"
            title="Add manual comp"
          >
            <Icon name={showAddForm ? 'close' : 'add_circle'} size="text-lg" />
          </button>
        )}
      </div>

      {/* Statistics Summary */}
      {comps.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-5 p-4 bg-surface-container-lowest rounded-lg">
          <div>
            <p className="text-[9px] font-bold uppercase text-on-surface-variant mb-1">Avg Price</p>
            <p className="text-lg font-black text-primary">
              ${Math.floor(avgPrice).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase text-on-surface-variant mb-1">Avg $/SF</p>
            <p className="text-lg font-black text-primary">
              {avgPricePerSqft > 0 ? `$${Math.floor(avgPricePerSqft)}` : '—'}
            </p>
          </div>
          {avgPrice > 0 && (
            <div className="col-span-2 pt-3 border-t border-outline-variant/20">
              <p className="text-[9px] font-bold uppercase text-on-surface-variant mb-1">Suggested ARV Range</p>
              <p className="text-sm font-black text-secondary">
                ${arvLow.toLocaleString()} – ${arvHigh.toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Manual Comp Entry Form */}
      {showAddForm && onAddManualComp && (
        <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs font-bold text-blue-800 mb-3">Add Manual Comp</p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              onAddManualComp({
                address: formData.get('address') as string,
                price: Number(formData.get('price')),
                sale_date: formData.get('sale_date') as string,
                beds: formData.get('beds') ? Number(formData.get('beds')) : undefined,
                baths: formData.get('baths') ? Number(formData.get('baths')) : undefined,
                sqft: formData.get('sqft') ? Number(formData.get('sqft')) : undefined,
                source: 'manual',
              })
              setShowAddForm(false)
              e.currentTarget.reset()
            }}
            className="space-y-2"
          >
            <input
              name="address"
              placeholder="Address"
              required
              className="w-full px-3 py-2 text-xs rounded border border-outline-variant/30 bg-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                name="price"
                type="number"
                placeholder="Sale Price"
                required
                className="px-3 py-2 text-xs rounded border border-outline-variant/30 bg-white"
              />
              <input
                name="sale_date"
                type="date"
                required
                className="px-3 py-2 text-xs rounded border border-outline-variant/30 bg-white"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                name="beds"
                type="number"
                placeholder="Beds"
                className="px-3 py-2 text-xs rounded border border-outline-variant/30 bg-white"
              />
              <input
                name="baths"
                type="number"
                placeholder="Baths"
                className="px-3 py-2 text-xs rounded border border-outline-variant/30 bg-white"
              />
              <input
                name="sqft"
                type="number"
                placeholder="Sqft"
                className="px-3 py-2 text-xs rounded border border-outline-variant/30 bg-white"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-primary text-white rounded-lg text-xs font-bold hover:opacity-90"
            >
              Add Comp
            </button>
          </form>
        </div>
      )}

      {/* Comps List */}
      {comps.length === 0 ? (
        <div className="text-center py-8">
          <Icon name="home_work" className="!text-3xl text-on-surface-variant/30 mb-2" />
          <p className="text-xs text-on-surface-variant/60 mb-1">No comps loaded</p>
          <p className="text-[10px] text-on-surface-variant/40">
            Pull from MLS or add manually
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {comps.map((comp) => (
            <div
              key={comp.id}
              className="p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/10 hover:border-primary/30 transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <p className="text-sm font-bold text-primary mb-1">
                    {comp.address}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {comp.beds && comp.baths && (
                      <span className="text-[10px] text-on-surface-variant">
                        {comp.beds} bed / {comp.baths} bath
                      </span>
                    )}
                    {comp.sqft && (
                      <span className="text-[10px] text-on-surface-variant">
                        • {comp.sqft.toLocaleString()} SF
                      </span>
                    )}
                    {comp.distance && (
                      <span className="text-[10px] text-on-surface-variant">
                        • {comp.distance}
                      </span>
                    )}
                  </div>
                </div>
                {comp.source && (
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                    comp.source === 'mls'
                      ? 'bg-purple-100 text-purple-700'
                      : comp.source === 'county'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {comp.source}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-black text-primary">
                    ${comp.price.toLocaleString()}
                  </p>
                  {comp.sqft && comp.price && (
                    <p className="text-[10px] text-on-surface-variant">
                      ${Math.floor(comp.price / comp.sqft)}/SF
                    </p>
                  )}
                </div>
                {comp.sale_date && (
                  <p className="text-[10px] text-on-surface-variant">
                    Sold {new Date(comp.sale_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalComps > comps.length && (
        <button className="w-full mt-4 py-2 border border-outline-variant/30 rounded-lg text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-all">
          View All {totalComps} Comps
        </button>
      )}
    </section>
  )
}
