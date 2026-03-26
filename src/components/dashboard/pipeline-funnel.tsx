'use client'

interface FunnelStage {
  label: string
  subtitle: string
  count: number
  color: string
  indent: string
  width: string
}

const stages: FunnelStage[] = [
  {
    label: 'Stage: Leads =',
    subtitle: '100% of pipeline',
    count: 2847,
    color: 'bg-blue-500',
    indent: 'ml-0',
    width: 'w-full',
  },
  {
    label: 'Stage: Opportunities',
    subtitle: '39.2% conversion',
    count: 1115,
    color: 'bg-emerald-400',
    indent: 'ml-[5%]',
    width: 'w-[95%]',
  },
  {
    label: 'Stage: Offers Made',
    subtitle: '61.4% of opportunities',
    count: 685,
    color: 'bg-amber-400',
    indent: 'ml-[10%]',
    width: 'w-[90%]',
  },
  {
    label: 'Stage: Deals Closed',
    subtitle: '18.5% offer close rate',
    count: 127,
    color: 'bg-purple-600',
    indent: 'ml-[15%]',
    width: 'w-[85%]',
  },
]

export function PipelineFunnel() {
  return (
    <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm flex flex-col">
      <h4 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-8 text-center">
        Sales Pipeline Flow
      </h4>
      <div className="space-y-3 flex-1">
        {stages.map((stage) => (
          <div
            key={stage.label}
            className={`funnel-step ${stage.color} text-white p-4 flex justify-between items-center ${stage.indent} ${stage.width}`}
          >
            <div className="flex flex-col">
              <span className="text-[10px] font-bold opacity-80 uppercase">{stage.label}</span>
              <span className="text-xs italic opacity-70">{stage.subtitle}</span>
            </div>
            <span className="text-xl font-black">{stage.count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
