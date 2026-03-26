'use client'

import { Icon } from '@/components/ui/icon'

interface ConversionMetric {
  value: string
  label: string
  change: string
  positive: boolean
}

const metrics: ConversionMetric[] = [
  { value: '39.2%', label: 'Lead \u2192 Opportunity', change: '2.1%', positive: true },
  { value: '61.4%', label: 'Opportunity \u2192 Offer', change: '3.2%', positive: false },
  { value: '18.5%', label: 'Offer \u2192 Close', change: '1.8%', positive: false },
  { value: '4.5%', label: 'Overall Conversion', change: '0.3%', positive: false },
]

export function ConversionHealth() {
  return (
    <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
      <h4 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-8 text-center">
        Conversion Health Check
      </h4>
      <div className="grid grid-cols-2 gap-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="bg-slate-50 p-6 rounded-xl border border-slate-100 flex flex-col items-center justify-center text-center"
          >
            <span className="text-2xl font-black text-primary">{metric.value}</span>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight mt-1">
              {metric.label}
            </span>
            <div className={`mt-2 flex items-center gap-1 text-[9px] font-black ${metric.positive ? 'text-secondary' : 'text-error'}`}>
              <Icon
                name={metric.positive ? 'trending_up' : 'trending_down'}
                className="text-[10px]"
              />
              {metric.change}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
