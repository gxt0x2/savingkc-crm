interface CompProperty {
  id: string
  address: string
  status: string
  distance: string
  price: number
}

interface MarketCompsProps {
  comps: CompProperty[]
  totalComps: number
}

export function MarketComps({ comps, totalComps }: MarketCompsProps) {
  return (
    <section className="bg-surface-container-low rounded-xl p-6">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-6">
        Market Comps
      </h2>

      <div className="space-y-4">
        {comps.map((comp) => (
          <div
            key={comp.id}
            className="flex justify-between items-center group cursor-pointer"
          >
            <div>
              <p className="text-sm font-bold text-primary group-hover:text-secondary transition-colors">
                {comp.address}
              </p>
              <p className="text-[10px] text-on-surface-variant">
                {comp.status} &bull; {comp.distance} away
              </p>
            </div>
            <p className="text-sm font-black text-primary">
              ${comp.price.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <button className="w-full mt-6 py-2 border border-outline-variant/30 rounded-lg text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-all">
        View All {totalComps} Comps
      </button>
    </section>
  )
}
