'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { KpiCard, MetricCard } from '@/components/dashboard/kpi-card'
import { TrendChart } from '@/components/dashboard/trend-chart'
import { PipelineFunnel } from '@/components/dashboard/pipeline-funnel'
import { ColdCallStats } from '@/components/dashboard/cold-call-stats'
import { ConversionHealth } from '@/components/dashboard/conversion-health'
import { createClient } from '@/lib/supabase/client'

interface LeadCounts {
  total: number
  byStation: Record<string, number>
  byPriority: Record<string, number>
}

interface MojoKpis {
  totalCalls: number
  meaningfulCalls: number
  avgMotivation: number
  hotLeads: number
  date?: string
}

function useLeadCounts() {
  const [data, setData] = useState<LeadCounts | null>(null)
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('leads')
      .select('station, priority')
      .then(({ data: rows }) => {
        if (!rows) return
        const byStation: Record<string, number> = {}
        const byPriority: Record<string, number> = {}
        for (const row of rows) {
          const s = row.station || 'unknown'
          const p = row.priority || 'normal'
          byStation[s] = (byStation[s] || 0) + 1
          byPriority[p] = (byPriority[p] || 0) + 1
        }
        setData({ total: rows.length, byStation, byPriority })
      })
  }, [])
  return data
}

function useMojoKpis() {
  const [data, setData] = useState<MojoKpis | null>(null)
  useEffect(() => {
    fetch('/api/mojo-kpis')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
  }, [])
  return data
}

export default function DashboardPage() {
  const leadCounts = useLeadCounts()
  const mojoKpis = useMojoKpis()

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] mx-auto w-full space-y-6 pb-32">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-1 block">
            Executive Intelligence
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-primary">
            Portfolio Performance
          </h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2">
            <Icon name="calendar_today" className="text-lg" />
            Today
          </button>
          <button className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-slate-800 transition-colors flex items-center gap-2">
            <Icon name="download" className="text-lg" />
            Export Report
          </button>
        </div>
      </div>

      {/* Mojo KPI Cards */}
      {mojoKpis !== null && (
        <div>
          <h3 className="text-xs font-black text-secondary uppercase tracking-[0.2em] mb-3">
            Mojo Dialer — {mojoKpis.date || 'Mar 20'}
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Calls</div>
              <div className="text-3xl font-black text-primary">{mojoKpis.totalCalls}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Meaningful Calls</div>
              <div className="text-3xl font-black text-secondary">{mojoKpis.meaningfulCalls}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Motivation</div>
              <div className="text-3xl font-black text-primary">{mojoKpis.avgMotivation}/10</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Hot Leads</div>
              <div className="text-3xl font-black text-red-500">{mojoKpis.hotLeads}</div>
            </div>
          </div>
        </div>
      )}

      {/* Live Lead Counts */}
      <div>
        <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-3">
          Live Lead Pipeline
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Leads</div>
            <div className="text-3xl font-black text-primary">{leadCounts?.total ?? '—'}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Intake</div>
            <div className="text-3xl font-black text-slate-700">{leadCounts?.byStation?.intake ?? 0}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Hot Priority</div>
            <div className="text-3xl font-black text-red-500">{leadCounts?.byPriority?.hot ?? 0}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Normal Priority</div>
            <div className="text-3xl font-black text-slate-700">{leadCounts?.byPriority?.normal ?? 0}</div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        <KpiCard
          label="Revenue"
          value="$1.07M"
          subtitle="127 deals closed"
          trendValue="23%"
          trendDirection="up"
        />
        <KpiCard
          label="Expense"
          value="$42K"
          subtitle="Revenue per day"
          trendValue="11%"
          trendDirection="up"
        />
        <KpiCard
          label="Profit Margin"
          value="23.5%"
          subtitle="Net margin maintained"
          trendValue="3%"
          trendDirection="up"
        />
      </div>

      {/* Metric Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard value="$45" label="Cost Per Lead" change="12% QoQ" changeDirection="down" />
        <MetricCard value="$8,420" label="Avg. Assignment" change="15% QoQ" changeDirection="up" />
        <MetricCard value="$3,740" label="Acquisition Cost" change="5% QoQ" changeDirection="down" />
        <MetricCard value="6.8:1" label="LTV to CAC Ratio" change="22% QoQ" changeDirection="up" />
        <MetricCard value="45" label="Cash Conversion (Days)" change="18% QoQ" changeDirection="down" />
      </div>

      {/* Trend Analysis */}
      <TrendChart />

      {/* Bottom Section: Cold Call + Funnel/Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ColdCallStats />

        <div className="space-y-6">
          <h4 className="text-xs font-black text-primary uppercase tracking-[0.2em]">Flow & Health</h4>
          <PipelineFunnel />
          <ConversionHealth />
        </div>
      </div>
    </div>
  )
}
