interface PainPoint {
  period: 'past' | 'present' | 'future'
  description: string
}

interface PainPointsProps {
  painPoints: PainPoint[]
}

export function PainPoints({ painPoints }: PainPointsProps) {
  return (
    <section className="bg-surface-container-low rounded-xl p-6">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-6">
        Seller Pain Points
      </h2>

      <div className="space-y-6 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-outline-variant/20">
        {painPoints.map((point) => {
          const isPast = point.period === 'past'
          const isPresent = point.period === 'present'
          const isFuture = point.period === 'future'

          return (
            <div key={point.period} className={`relative pl-8 ${isFuture ? 'opacity-60' : ''}`}>
              <div
                className={`absolute left-0 top-1 w-6 h-6 rounded-full border-4 border-surface-container-low flex items-center justify-center ${
                  isPresent ? 'bg-secondary-container' : 'bg-surface-container-highest'
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    isPresent ? 'bg-secondary' : 'bg-outline'
                  }`}
                />
              </div>

              <p
                className={`text-[10px] font-black uppercase mb-0.5 ${
                  isPresent ? 'text-secondary' : 'text-on-surface-variant'
                }`}
              >
                {point.period}
              </p>
              <p
                className={`text-sm ${
                  isPresent ? 'font-bold text-primary' : 'font-medium'
                }`}
              >
                {point.description}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
