'use client'

import { useState } from 'react'

type TimeRange = 'Daily' | 'Weekly' | 'Monthly'

interface TrendRow {
  label: string
  total: string
  change: string
  changePositive: boolean
  maxValue: number
  bars: number[]
  color: string
  activeColor: string
  highlightIndex: number
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const trendData: TrendRow[] = [
  {
    label: 'New Leads',
    total: '38 Total',
    change: '+12%',
    changePositive: true,
    maxValue: 40,
    bars: [60, 45, 70, 95, 50, 65, 40],
    color: 'bg-blue-100',
    activeColor: 'bg-blue-500',
    highlightIndex: 3,
  },
  {
    label: 'Opportunities',
    total: '22 Total',
    change: '+5%',
    changePositive: true,
    maxValue: 30,
    bars: [40, 55, 75, 85, 60, 45, 30],
    color: 'bg-emerald-100',
    activeColor: 'bg-emerald-500',
    highlightIndex: 3,
  },
  {
    label: 'Offers Made',
    total: '18 Total',
    change: '-15%',
    changePositive: false,
    maxValue: 20,
    bars: [85, 80, 90, 65, 70, 75, 55],
    color: 'bg-amber-100',
    activeColor: 'bg-amber-500',
    highlightIndex: 3,
  },
  {
    label: 'Deals Closed',
    total: '6 Total',
    change: '+22%',
    changePositive: true,
    maxValue: 10,
    bars: [25, 45, 55, 70, 40, 35, 20],
    color: 'bg-purple-100',
    activeColor: 'bg-purple-600',
    highlightIndex: 3,
  },
]

export function TrendChart() {
  const [timeRange, setTimeRange] = useState<TimeRange>('Daily')

  return (
    <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm space-y-8">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-xs font-black text-primary uppercase tracking-[0.2em]">Operational Trend Analysis</h4>
        <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
          {(['Daily', 'Weekly', 'Monthly'] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 text-[10px] font-bold rounded-md ${
                timeRange === range
                  ? 'bg-white shadow-sm text-primary'
                  : 'text-slate-400'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-10">
        {trendData.map((row) => (
          <div key={row.label} className="flex items-center gap-6">
            <div className="w-32 shrink-0">
              <h5 className="text-[10px] font-black uppercase text-slate-400 mb-1">{row.label}</h5>
              <div className="text-lg font-black text-slate-900">{row.total}</div>
              <div className={`text-[10px] font-bold ${row.changePositive ? 'text-secondary' : 'text-error'}`}>
                {row.change}
              </div>
            </div>
            <div className="flex-1 flex gap-2">
              <div className="flex flex-col justify-between text-[8px] font-bold text-slate-300 pb-5 h-16">
                <span>{row.maxValue}</span>
                <span>0</span>
              </div>
              <div className="flex-1">
                <div className="flex items-end justify-between h-16 gap-2 border-b border-slate-100">
                  {row.bars.map((height, i) => (
                    <div
                      key={i}
                      className={`w-full rounded-sm ${i === row.highlightIndex ? row.activeColor : row.color}`}
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-2 text-[8px] font-bold text-slate-400 uppercase tracking-tighter px-1">
                  {DAYS.map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
