'use client'

import { Icon } from '@/components/ui/icon'

interface KpiCardProps {
  label: string
  value: string
  subtitle: string
  trendValue: string
  trendDirection: 'up' | 'down'
}

export function KpiCard({ label, value, subtitle, trendValue, trendDirection }: KpiCardProps) {
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between">
      <div className="flex justify-between items-start">
        <div>
          <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">{label}</span>
          <h3 className="text-3xl font-black text-primary mt-1">{value}</h3>
          <p className="text-[10px] text-slate-400 mt-1 font-medium italic">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1 bg-green-50 text-secondary px-2 py-0.5 rounded text-[10px] font-black">
          <Icon
            name={trendDirection === 'up' ? 'trending_up' : 'trending_down'}
            className="text-xs"
          />
          {trendValue}
        </div>
      </div>
    </div>
  )
}

interface MetricCardProps {
  value: string
  label: string
  change: string
  changeDirection: 'up' | 'down'
}

export function MetricCard({ value, label, change, changeDirection }: MetricCardProps) {
  const isPositive = changeDirection === 'up'

  return (
    <div className="bg-white p-4 rounded-xl border border-slate-100 text-center">
      <div className="text-xl font-black text-primary">{value}</div>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{label}</div>
      <div className={`mt-2 text-[10px] font-bold flex items-center justify-center gap-1 ${isPositive ? 'text-secondary' : 'text-error'}`}>
        <Icon name={isPositive ? 'arrow_upward' : 'arrow_downward'} className="text-[10px]" />
        {change}
      </div>
    </div>
  )
}
