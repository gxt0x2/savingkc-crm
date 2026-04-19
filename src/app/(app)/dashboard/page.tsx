'use client'

import { useEffect, useState, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { useFinancials } from '@/hooks/use-financials'
import { formatPhone } from '@/lib/format'

interface LeadCounts {
  total: number
  byStation: Record<string, number>
  byPriority: Record<string, number>
  daysSinceLastContract: number | null
  daysSinceLastContractSigned: number | null
}

interface YtdKpis {
  agent: string
  monthly: { month: string; dialTimeHrs: number; calls: number; contacts: number; leads: number; appointments: number }[]
  ytd: { dialTimeHrs: number; calls: number; contacts: number; leads: number; appointments: number; contactRate: string; leadRate: string; months: number }
}

interface MojoKpis {
  totalCalls: number
  meaningfulCalls: number
  avgMotivation: number
  hotLeads: number
  date?: string
  cumulative?: {
    since: string
    totalCalls: number
    meaningfulCalls: number
    hotLeads: number
    days: number
  }
}

interface ActivityCounts {
  calls: number
  sms_sent: number
  sms_received: number
  voicemails: number
}

interface Task {
  id: string
  title: string
  due_date: string | null
  priority: string
  status: string
  lead_id: string | null
}

interface HotLead {
  id: string
  full_name: string | null
  phone: string | null
  source: string | null
  created_at: string
  station: string | null
}

interface AppointmentStats {
  showRate30Day: number
  showRateByType: { phone: number; inPerson: number }
  confirmationRate: number
  ghostProtocolActivationRate: number
  ghostProtocolRecoveryRate: number
  avgConfirmationCount: number
  totalAppointments: number
  completed: number
  noShows: number
  cancelled: number
  rescheduled: number
}

interface TrendBucket {
  label: string
  calls: number
  sms_sent: number
  sms_received: number
  leads_created: number
  tasks_completed: number
}

interface TrendsData {
  period: string
  days: number
  buckets: TrendBucket[]
}

/* ── Animated number counter ── */
function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<number>(0)

  useEffect(() => {
    if (value === 0) { setDisplay(0); return }
    const start = ref.current
    const diff = value - start
    const startTime = performance.now()

    function tick(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      const current = Math.round(start + diff * eased)
      setDisplay(current)
      if (progress < 1) requestAnimationFrame(tick)
      else ref.current = value
    }
    requestAnimationFrame(tick)
  }, [value, duration])

  return <>{display}</>
}

/* ── Ring progress (SVG) ── */
function ProgressRing({ value, max, size = 48, stroke = 4, color = '#16a34a' }: { value: number; max: number; size?: number; stroke?: number; color?: string }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const offset = circumference * (1 - pct)

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-100" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-1000 ease-out" />
    </svg>
  )
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function useLeadCounts() {
  const [data, setData] = useState<LeadCounts | null>(null)
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('leads')
      .select('station, priority, created_at')
      .then(({ data: rows }) => {
        if (!rows) return
        const byStation: Record<string, number> = {}
        const byPriority: Record<string, number> = {}
        let lastContractDate: string | null = null
        for (const row of rows) {
          const s = row.station || 'unknown'
          const p = row.priority || 'normal'
          byStation[s] = (byStation[s] || 0) + 1
          byPriority[p] = (byPriority[p] || 0) + 1
          if (s === 'contract_signed') {
            if (!lastContractDate || row.created_at > lastContractDate) {
              lastContractDate = row.created_at
            }
          }
        }
        const daysSinceContract = daysSince(lastContractDate)
        setData({ total: rows.length, byStation, byPriority, daysSinceLastContract: daysSinceContract, daysSinceLastContractSigned: daysSinceContract })
      })
  }, [])
  return data
}

function useMojoKpis() {
  const [data, setData] = useState<MojoKpis | null>(null)
  useEffect(() => {
    fetch('/api/mojo-kpis').then((r) => r.json()).then(setData).catch(() => {})
  }, [])
  return data
}

function useYtdKpis() {
  const [data, setData] = useState<YtdKpis | null>(null)
  useEffect(() => {
    fetch('/api/dashboard/kpis').then((r) => r.json()).then(setData).catch(() => {})
  }, [])
  return data
}

function useActivity() {
  const [data, setData] = useState<ActivityCounts | null>(null)
  useEffect(() => {
    fetch('/api/dashboard/activity').then((r) => r.json()).then(setData).catch(() => {})
  }, [])
  return data
}

function useTasks() {
  const [data, setData] = useState<Task[]>([])
  useEffect(() => {
    fetch('/api/dashboard/tasks').then((r) => r.json()).then((d) => setData(d.tasks || [])).catch(() => {})
  }, [])
  return data
}

function useHotLeads() {
  const [data, setData] = useState<HotLead[]>([])
  useEffect(() => {
    fetch('/api/dashboard/hot-leads').then((r) => r.json()).then((d) => setData(d.leads || [])).catch(() => {})
  }, [])
  return data
}

function useAppointmentStats() {
  const [data, setData] = useState<AppointmentStats | null>(null)
  useEffect(() => {
    fetch('/api/dashboard/appointment-stats').then((r) => r.json()).then(setData).catch(() => {})
  }, [])
  return data
}

function useTrends(period: string, days: number) {
  const [data, setData] = useState<TrendsData | null>(null)
  useEffect(() => {
    fetch(`/api/dashboard/trends?period=${period}&days=${days}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
  }, [period, days])
  return data
}

export default function DashboardPage() {
  const leadCounts = useLeadCounts()
  const mojoKpis = useMojoKpis()
  const { data: financials } = useFinancials()
  const activity = useActivity()
  const tasks = useTasks()
  const hotLeads = useHotLeads()
  const ytdKpis = useYtdKpis()

  const apptStats = useAppointmentStats()

  const [trendPeriod, setTrendPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [trendDays, setTrendDays] = useState(30)
  const [trendMetrics, setTrendMetrics] = useState<string[]>(['calls', 'leads_created'])
  const trends = useTrends(trendPeriod, trendDays)

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] mx-auto w-full space-y-8 pb-32">
      {/* Header */}
      <div>
        <span className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-1 block">
          KPIs
        </span>
        <h2 className="text-3xl font-extrabold tracking-tight text-primary">
          Today&apos;s Overview
        </h2>
      </div>

      {/* ═══ YEAR-TO-DATE KPIs (from KPI Tracker spreadsheet) ═══ */}
      {ytdKpis && (
        <div>
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
            <Icon name="bar_chart" className="text-sm" /> {ytdKpis.agent} — Year to Date (Jan–Mar 2026)
          </h3>
          {/* YTD Hero Numbers */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 p-5 shadow-lg col-span-2 lg:col-span-1">
              <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Total Dials</div>
              <div className="text-4xl font-black text-white tabular-nums">
                <AnimatedNumber value={ytdKpis.ytd.calls} duration={2000} />
              </div>
              <div className="text-[10px] text-slate-500 mt-1">{ytdKpis.ytd.dialTimeHrs.toFixed(0)}hrs dial time</div>
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 shadow-lg shadow-blue-600/20">
              <div className="text-blue-100 text-[10px] font-bold uppercase tracking-wider mb-1">Contacts</div>
              <div className="text-4xl font-black text-white tabular-nums">
                <AnimatedNumber value={ytdKpis.ytd.contacts} duration={1500} />
              </div>
              <div className="text-[10px] text-blue-200 mt-1">{ytdKpis.ytd.contactRate}% contact rate</div>
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-green-700 p-5 shadow-lg shadow-emerald-600/20">
              <div className="text-emerald-100 text-[10px] font-bold uppercase tracking-wider mb-1">Leads</div>
              <div className="text-4xl font-black text-white tabular-nums">
                <AnimatedNumber value={ytdKpis.ytd.leads} duration={1200} />
              </div>
              <div className="text-[10px] text-emerald-200 mt-1">{ytdKpis.ytd.leadRate}% lead rate</div>
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 p-5 shadow-lg shadow-amber-500/20">
              <div className="text-amber-100 text-[10px] font-bold uppercase tracking-wider mb-1">Appointments</div>
              <div className="text-4xl font-black text-white tabular-nums">
                <AnimatedNumber value={ytdKpis.ytd.appointments} duration={1000} />
              </div>
              <div className="text-[10px] text-amber-200 mt-1">Set from calls</div>
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-600 to-violet-700 p-5 shadow-lg shadow-purple-600/20">
              <div className="text-purple-100 text-[10px] font-bold uppercase tracking-wider mb-1">Dial Time</div>
              <div className="text-4xl font-black text-white tabular-nums">
                {ytdKpis.ytd.dialTimeHrs.toFixed(0)}<span className="text-lg text-purple-200">h</span>
              </div>
              <div className="text-[10px] text-purple-200 mt-1">{(ytdKpis.ytd.dialTimeHrs / ytdKpis.ytd.months).toFixed(1)}h/mo avg</div>
            </div>
          </div>
          {/* Monthly breakdown bars */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Monthly Breakdown — Calls</div>
            <div className="space-y-3">
              {ytdKpis.monthly.map((m) => {
                const maxCalls = Math.max(...ytdKpis.monthly.map(x => x.calls))
                return (
                  <div key={m.month} className="flex items-center gap-3">
                    <div className="w-16 text-xs font-bold text-slate-500">{m.month.replace(' 2026', '')}</div>
                    <div className="flex-1 h-8 bg-slate-50 rounded-lg overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg transition-all duration-1000 ease-out flex items-center justify-end pr-3"
                        style={{ width: `${(m.calls / maxCalls) * 100}%` }}
                      >
                        <span className="text-[10px] font-black text-white">{m.calls.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="w-24 text-right">
                      <span className="text-[10px] font-bold text-emerald-500">{m.contacts} contacts</span>
                      <span className="text-[10px] text-slate-300 mx-1">/</span>
                      <span className="text-[10px] font-bold text-amber-500">{m.leads} leads</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ TODAY'S ACTIVITY — Hero cards with gradient backgrounds ═══ */}
      <div>
        <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> Live Activity
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Calls */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 p-5 shadow-lg shadow-blue-500/20">
            <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <Icon name="call" className="text-white/80 text-lg" />
            </div>
            <div className="text-blue-100 text-[10px] font-bold uppercase tracking-wider mb-1">Calls</div>
            <div className="text-4xl font-black text-white tabular-nums">
              <AnimatedNumber value={activity?.calls ?? 0} />
            </div>
            <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white/40 rounded-full transition-all duration-1000" style={{ width: `${Math.min((activity?.calls ?? 0) / 50 * 100, 100)}%` }} />
            </div>
          </div>
          {/* SMS Sent */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 p-5 shadow-lg shadow-emerald-500/20">
            <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <Icon name="send" className="text-white/80 text-lg" />
            </div>
            <div className="text-emerald-100 text-[10px] font-bold uppercase tracking-wider mb-1">SMS Sent</div>
            <div className="text-4xl font-black text-white tabular-nums">
              <AnimatedNumber value={activity?.sms_sent ?? 0} />
            </div>
            <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white/40 rounded-full transition-all duration-1000" style={{ width: `${Math.min((activity?.sms_sent ?? 0) / 30 * 100, 100)}%` }} />
            </div>
          </div>
          {/* SMS Received */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 p-5 shadow-lg shadow-violet-500/20">
            <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <Icon name="inbox" className="text-white/80 text-lg" />
            </div>
            <div className="text-violet-100 text-[10px] font-bold uppercase tracking-wider mb-1">SMS Received</div>
            <div className="text-4xl font-black text-white tabular-nums">
              <AnimatedNumber value={activity?.sms_received ?? 0} />
            </div>
            <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white/40 rounded-full transition-all duration-1000" style={{ width: `${Math.min((activity?.sms_received ?? 0) / 30 * 100, 100)}%` }} />
            </div>
          </div>
          {/* Voicemails */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 p-5 shadow-lg shadow-amber-500/20">
            <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
              <Icon name="voicemail" className="text-white/80 text-lg" />
            </div>
            <div className="text-amber-100 text-[10px] font-bold uppercase tracking-wider mb-1">Voicemails</div>
            <div className="text-4xl font-black text-white tabular-nums">
              <AnimatedNumber value={activity?.voicemails ?? 0} />
            </div>
            <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white/40 rounded-full transition-all duration-1000" style={{ width: `${Math.min((activity?.voicemails ?? 0) / 10 * 100, 100)}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ MOJO DIALER ═══ */}
      {mojoKpis !== null && (
        <div>
          <h3 className="text-xs font-black text-secondary uppercase tracking-[0.2em] mb-4">
            Mojo Dialer — {mojoKpis.date || 'Today'}
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Calls</div>
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Icon name="phone_in_talk" className="text-blue-500 text-sm" />
                </div>
              </div>
              <div className="text-4xl font-black text-primary tabular-nums">
                <AnimatedNumber value={mojoKpis.totalCalls} />
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Meaningful</div>
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <Icon name="thumb_up" className="text-green-500 text-sm" />
                </div>
              </div>
              <div className="text-4xl font-black text-secondary tabular-nums">
                <AnimatedNumber value={mojoKpis.meaningfulCalls} />
              </div>
              {mojoKpis.totalCalls > 0 && (
                <div className="mt-2 text-[10px] font-bold text-slate-400">
                  {Math.round((mojoKpis.meaningfulCalls / mojoKpis.totalCalls) * 100)}% connect rate
                </div>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Motivation</div>
                <div className="relative flex items-center justify-center">
                  <ProgressRing value={mojoKpis.avgMotivation} max={10} size={36} stroke={3} color={mojoKpis.avgMotivation >= 7 ? '#16a34a' : mojoKpis.avgMotivation >= 4 ? '#f59e0b' : '#ef4444'} />
                  <span className="absolute text-[10px] font-black text-primary">{mojoKpis.avgMotivation}</span>
                </div>
              </div>
              <div className="text-4xl font-black text-primary tabular-nums">
                {mojoKpis.avgMotivation}<span className="text-lg text-slate-300">/10</span>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-red-100 p-5 shadow-sm hover:shadow-md transition-shadow ring-1 ring-red-50">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Hot Leads</div>
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                  <Icon name="local_fire_department" className="text-red-500 text-sm" />
                </div>
              </div>
              <div className="text-4xl font-black text-red-500 tabular-nums">
                <AnimatedNumber value={mojoKpis.hotLeads} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CUMULATIVE MOJO STATS (since Feb 1) ═══ */}
      {mojoKpis?.cumulative && mojoKpis.cumulative.days > 0 && (
        <div>
          <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-4">
            Cumulative Since {new Date(mojoKpis.cumulative.since + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ({mojoKpis.cumulative.days} sessions)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 shadow-lg">
              <div className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Total Dials</div>
              <div className="text-4xl font-black text-white tabular-nums">
                <AnimatedNumber value={mojoKpis.cumulative.totalCalls} duration={1800} />
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                ~{Math.round(mojoKpis.cumulative.totalCalls / mojoKpis.cumulative.days)} per session
              </div>
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-600 to-emerald-700 p-5 shadow-lg shadow-green-600/20">
              <div className="text-green-100 text-[10px] font-bold uppercase tracking-wider mb-1">Meaningful Calls</div>
              <div className="text-4xl font-black text-white tabular-nums">
                <AnimatedNumber value={mojoKpis.cumulative.meaningfulCalls} duration={1800} />
              </div>
              <div className="text-[10px] text-green-200 mt-1">
                Leads open to selling / follow-up
              </div>
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 p-5 shadow-lg shadow-red-500/20">
              <div className="text-red-100 text-[10px] font-bold uppercase tracking-wider mb-1">Hot Leads Found</div>
              <div className="text-4xl font-black text-white tabular-nums">
                <AnimatedNumber value={mojoKpis.cumulative.hotLeads} duration={1800} />
              </div>
              <div className="text-[10px] text-red-200 mt-1">
                High motivation (7+/10)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ ACTIVITY TRENDS — compare over time ═══ */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] flex items-center gap-2">
            <Icon name="trending_up" className="text-sm" /> Activity Trends
          </h3>
          <div className="flex items-center gap-2">
            {/* Period selector */}
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {(['daily', 'weekly', 'monthly'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setTrendPeriod(p)
                    setTrendDays(p === 'monthly' ? 180 : p === 'weekly' ? 90 : 30)
                  }}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                    trendPeriod === p ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            {/* Metric toggles */}
            <div className="hidden sm:flex gap-1">
              {[
                { key: 'calls', label: 'Calls', color: 'bg-blue-500' },
                { key: 'sms_sent', label: 'SMS', color: 'bg-emerald-500' },
                { key: 'leads_created', label: 'Leads', color: 'bg-amber-500' },
              ].map(({ key, label, color }) => (
                <button
                  key={key}
                  onClick={() =>
                    setTrendMetrics((prev) =>
                      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
                    )
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                    trendMetrics.includes(key)
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-50 text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          {!trends || trends.buckets.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-slate-300">
              <Icon name="show_chart" className="text-3xl mr-2 text-slate-200" />
              No activity data yet for this period
            </div>
          ) : (
            <div>
              {/* Bar chart */}
              <div className="flex items-end gap-[2px] h-48">
                {trends.buckets.map((b, i) => {
                  const metricColors: Record<string, string> = {
                    calls: 'bg-blue-500',
                    sms_sent: 'bg-emerald-500',
                    sms_received: 'bg-violet-400',
                    leads_created: 'bg-amber-500',
                    tasks_completed: 'bg-green-500',
                  }
                  const maxVal = Math.max(
                    ...trends.buckets.map((bb) =>
                      trendMetrics.reduce((sum, m) => sum + ((bb as unknown as Record<string, number>)[m] || 0), 0)
                    ),
                    1
                  )
                  const total = trendMetrics.reduce((sum, m) => sum + ((b as unknown as Record<string, number>)[m] || 0), 0)
                  const pct = Math.max((total / maxVal) * 100, total > 0 ? 4 : 0)

                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative min-w-0">
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 pointer-events-none">
                        <div className="bg-slate-900 text-white px-3 py-2 rounded-lg text-[10px] whitespace-nowrap shadow-xl">
                          <div className="font-bold mb-1">{b.label}</div>
                          {trendMetrics.map((m) => (
                            <div key={m} className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${metricColors[m]}`} />
                              <span className="capitalize">{m.replace('_', ' ')}: </span>
                              <span className="font-bold">{(b as unknown as Record<string, number>)[m] || 0}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Stacked bars */}
                      <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                        {trendMetrics.map((m) => {
                          const val = (b as unknown as Record<string, number>)[m] || 0
                          const segPct = maxVal > 0 ? (val / maxVal) * 100 : 0
                          return (
                            <div
                              key={m}
                              className={`w-full ${metricColors[m]} first:rounded-t transition-all duration-500 ease-out`}
                              style={{ height: `${segPct}%`, minHeight: val > 0 ? '2px' : '0' }}
                            />
                          )
                        })}
                      </div>
                      {/* Label (show every few) */}
                      {(trends.buckets.length <= 14 || i % Math.ceil(trends.buckets.length / 12) === 0) && (
                        <div className="text-[8px] text-slate-300 font-bold truncate w-full text-center mt-1">
                          {b.label.replace(' 2026', '')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* Legend */}
              <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-slate-50">
                {trendMetrics.map((m) => {
                  const colors: Record<string, string> = {
                    calls: 'bg-blue-500',
                    sms_sent: 'bg-emerald-500',
                    sms_received: 'bg-violet-400',
                    leads_created: 'bg-amber-500',
                    tasks_completed: 'bg-green-500',
                  }
                  const total = trends.buckets.reduce((sum, bb) => sum + ((bb as unknown as Record<string, number>)[m] || 0), 0)
                  return (
                    <div key={m} className="flex items-center gap-1.5 text-[10px]">
                      <span className={`w-2 h-2 rounded-full ${colors[m]}`} />
                      <span className="text-slate-500 font-bold capitalize">{m.replace('_', ' ')}</span>
                      <span className="text-slate-800 font-black">{total}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ APPOINTMENT SHOW RATE ═══ */}
      {apptStats !== null && (
        <div>
          <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
            <Icon name="event_available" className="text-sm" /> Appointment Show Rate — 30 Day
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Show Rate — Hero Card */}
            <div className={`relative overflow-hidden rounded-2xl p-6 shadow-lg col-span-1 lg:col-span-1 ${
              apptStats.showRate30Day >= 90
                ? 'bg-gradient-to-br from-green-500 to-emerald-600 shadow-green-500/20'
                : apptStats.showRate30Day >= 85
                  ? 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/20'
                  : apptStats.totalAppointments === 0
                    ? 'bg-gradient-to-br from-slate-500 to-slate-700'
                    : 'bg-gradient-to-br from-red-500 to-red-700 shadow-red-500/20'
            }`}>
              <div className="absolute top-4 right-4 w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                <Icon name="percent" className="text-white/80 text-xl" />
              </div>
              <div className="text-white/80 text-[10px] font-bold uppercase tracking-wider mb-1">Show Rate</div>
              <div className="text-5xl font-black text-white tabular-nums">
                {apptStats.totalAppointments > 0 ? (
                  <><AnimatedNumber value={apptStats.showRate30Day} /><span className="text-2xl text-white/60">%</span></>
                ) : (
                  <span className="text-2xl">No data</span>
                )}
              </div>
              <div className="text-[10px] text-white/60 mt-2">
                Target: 90%+ {apptStats.showRate30Day >= 90 && apptStats.totalAppointments > 0 ? '-- On target' : ''}
              </div>
              {/* Completed vs No-Show */}
              <div className="flex gap-4 mt-4 pt-3 border-t border-white/10">
                <div>
                  <div className="text-2xl font-black text-white tabular-nums"><AnimatedNumber value={apptStats.completed} /></div>
                  <div className="text-[10px] text-white/60 font-bold uppercase">Completed</div>
                </div>
                <div>
                  <div className="text-2xl font-black text-white tabular-nums"><AnimatedNumber value={apptStats.noShows} /></div>
                  <div className="text-[10px] text-white/60 font-bold uppercase">No-Shows</div>
                </div>
                <div>
                  <div className="text-2xl font-black text-white tabular-nums"><AnimatedNumber value={apptStats.cancelled} /></div>
                  <div className="text-[10px] text-white/60 font-bold uppercase">Cancelled</div>
                </div>
              </div>
            </div>

            {/* Confirmation Stats */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Confirmation Stats</div>
              <div className="flex items-center gap-4">
                <div className="relative flex items-center justify-center">
                  <ProgressRing value={apptStats.confirmationRate} max={100} size={56} stroke={5} color={apptStats.confirmationRate >= 80 ? '#16a34a' : apptStats.confirmationRate >= 50 ? '#f59e0b' : '#ef4444'} />
                  <span className="absolute text-xs font-black text-primary">{apptStats.confirmationRate}%</span>
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-700">Confirmation Rate</div>
                  <div className="text-[10px] text-slate-400">Leads with 1+ confirmation</div>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50/80">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Icon name="mark_email_read" className="text-blue-500 text-sm" />
                </div>
                <div>
                  <div className="text-lg font-black text-primary tabular-nums">{apptStats.avgConfirmationCount}</div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase">Avg Confirmations</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-50">
                <div className="text-center p-2 rounded-lg bg-blue-50/50">
                  <div className="text-lg font-black text-blue-600 tabular-nums">{apptStats.showRateByType.phone}%</div>
                  <div className="text-[9px] font-bold text-blue-400 uppercase">Phone Show</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-emerald-50/50">
                  <div className="text-lg font-black text-emerald-600 tabular-nums">{apptStats.showRateByType.inPerson}%</div>
                  <div className="text-[9px] font-bold text-emerald-400 uppercase">In-Person Show</div>
                </div>
              </div>
            </div>

            {/* Ghost Protocol Stats */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Icon name="visibility_off" className="text-xs text-slate-300" /> Ghost Protocol
              </div>
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-md ${
                  apptStats.ghostProtocolActivationRate <= 10
                    ? 'bg-gradient-to-br from-green-500 to-green-600 shadow-green-500/20'
                    : apptStats.ghostProtocolActivationRate <= 25
                      ? 'bg-gradient-to-br from-amber-500 to-amber-600 shadow-amber-500/20'
                      : 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/20'
                }`}>
                  {apptStats.ghostProtocolActivationRate}%
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-700">Activation Rate</div>
                  <div className="text-[10px] text-slate-400">% of appts triggering ghost protocol</div>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50/80">
                <div className="relative flex items-center justify-center">
                  <ProgressRing value={apptStats.ghostProtocolRecoveryRate} max={100} size={48} stroke={4} color={apptStats.ghostProtocolRecoveryRate >= 50 ? '#16a34a' : '#ef4444'} />
                  <span className="absolute text-[10px] font-black text-primary">{apptStats.ghostProtocolRecoveryRate}%</span>
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-700">Recovery Rate</div>
                  <div className="text-[10px] text-slate-400">Ghost-triggered that still showed</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-50">
                <div className="text-center p-2 rounded-lg bg-slate-50/80">
                  <div className="text-lg font-black text-slate-600 tabular-nums"><AnimatedNumber value={apptStats.totalAppointments} /></div>
                  <div className="text-[9px] font-bold text-slate-400 uppercase">Total Appts</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-violet-50/50">
                  <div className="text-lg font-black text-violet-600 tabular-nums"><AnimatedNumber value={apptStats.rescheduled} /></div>
                  <div className="text-[9px] font-bold text-violet-400 uppercase">Rescheduled</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PIPELINE + OPERATIONAL — side by side ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Pipeline */}
        <div>
          <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-4">
            Lead Pipeline
          </h3>
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-5">
            {/* Total Leads — big hero number */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-slate-700 flex items-center justify-center shadow-lg shadow-primary/20">
                <Icon name="people" className="text-white text-2xl" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Leads</div>
                <div className="text-4xl font-black text-primary tabular-nums">
                  <AnimatedNumber value={leadCounts?.total ?? 0} />
                </div>
              </div>
            </div>
            {/* Pipeline breakdown bar */}
            <div className="space-y-3">
              {[
                { label: 'Intake', value: leadCounts?.byStation?.intake ?? 0, color: 'bg-blue-500', bg: 'bg-blue-50' },
                { label: 'Qualified', value: leadCounts?.byStation?.qualified ?? 0, color: 'bg-emerald-500', bg: 'bg-emerald-50' },
                { label: 'Offer Made', value: leadCounts?.byStation?.offer_made ?? 0, color: 'bg-amber-500', bg: 'bg-amber-50' },
                { label: 'Contract', value: leadCounts?.byStation?.contract_signed ?? 0, color: 'bg-green-600', bg: 'bg-green-50' },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-20 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
                  <div className={`flex-1 h-3 ${bg} rounded-full overflow-hidden`}>
                    <div
                      className={`h-full ${color} rounded-full transition-all duration-1000 ease-out`}
                      style={{ width: `${leadCounts?.total ? Math.max((value / leadCounts.total) * 100, value > 0 ? 4 : 0) : 0}%` }}
                    />
                  </div>
                  <div className="w-8 text-right text-sm font-black text-slate-600 tabular-nums">{value}</div>
                </div>
              ))}
            </div>
            {/* Priority split */}
            <div className="flex gap-3 pt-2 border-t border-slate-50">
              <div className="flex-1 text-center p-3 rounded-xl bg-red-50/50">
                <div className="text-2xl font-black text-red-500 tabular-nums"><AnimatedNumber value={leadCounts?.byPriority?.hot ?? 0} /></div>
                <div className="text-[10px] font-bold text-red-400 uppercase">Hot</div>
              </div>
              <div className="flex-1 text-center p-3 rounded-xl bg-slate-50">
                <div className="text-2xl font-black text-slate-600 tabular-nums"><AnimatedNumber value={leadCounts?.byPriority?.normal ?? 0} /></div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Normal</div>
              </div>
              <div className="flex-1 text-center p-3 rounded-xl bg-blue-50/50">
                <div className="text-2xl font-black text-blue-500 tabular-nums"><AnimatedNumber value={leadCounts?.byPriority?.cold ?? 0} /></div>
                <div className="text-[10px] font-bold text-blue-400 uppercase">Cold</div>
              </div>
            </div>
          </div>
        </div>

        {/* Operational Pulse */}
        <div>
          <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-4">
            Operational Pulse
          </h3>
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
            {/* Days since closing */}
            <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50/50">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-md ${
                leadCounts?.daysSinceLastContract != null
                  ? leadCounts.daysSinceLastContract > 30 ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30' : 'bg-gradient-to-br from-green-500 to-green-600 shadow-green-500/30'
                  : 'bg-slate-300'
              }`}>
                {leadCounts?.daysSinceLastContract != null ? leadCounts.daysSinceLastContract : '?'}
              </div>
              <div>
                <div className="text-sm font-bold text-slate-700">Days Since Last Closing</div>
                <div className="text-[10px] text-slate-400">{leadCounts?.daysSinceLastContract != null ? (leadCounts.daysSinceLastContract > 30 ? 'Time to close a deal!' : 'On track') : 'No closings yet'}</div>
              </div>
            </div>
            {/* Days since contract */}
            <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50/50">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-md ${
                leadCounts?.daysSinceLastContractSigned != null
                  ? leadCounts.daysSinceLastContractSigned > 14 ? 'bg-gradient-to-br from-orange-500 to-orange-600 shadow-orange-500/30' : 'bg-gradient-to-br from-secondary to-green-600 shadow-green-500/30'
                  : 'bg-slate-300'
              }`}>
                {leadCounts?.daysSinceLastContractSigned != null ? leadCounts.daysSinceLastContractSigned : '?'}
              </div>
              <div>
                <div className="text-sm font-bold text-slate-700">Days Since Last Contract</div>
                <div className="text-[10px] text-slate-400">{leadCounts?.daysSinceLastContractSigned != null ? (leadCounts.daysSinceLastContractSigned > 14 ? 'Getting stale' : 'Looking good') : 'No contracts yet'}</div>
              </div>
            </div>
            {/* Conversion Funnel */}
            <div className="pt-2 border-t border-slate-100">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Conversion Funnel</div>
              <div className="grid grid-cols-3 gap-2">
                {(() => {
                  const total = leadCounts?.total || 1
                  const qualified = (leadCounts?.byStation?.qualifying ?? 0) + (leadCounts?.byStation?.qualified ?? 0) + (leadCounts?.byStation?.appt_set ?? 0) + (leadCounts?.byStation?.negotiations ?? 0) + (leadCounts?.byStation?.offer_made ?? 0) + (leadCounts?.byStation?.contract_signed ?? 0)
                  const offered = (leadCounts?.byStation?.offer_made ?? 0) + (leadCounts?.byStation?.contract_signed ?? 0) + (leadCounts?.byStation?.negotiations ?? 0)
                  const closed = leadCounts?.byStation?.contract_signed ?? 0
                  return [
                    { label: 'Lead→Qualified', rate: total > 0 ? Math.round((qualified / total) * 100) : 0 },
                    { label: 'Qualified→Offer', rate: qualified > 0 ? Math.round((offered / qualified) * 100) : 0 },
                    { label: 'Offer→Close', rate: offered > 0 ? Math.round((closed / offered) * 100) : 0 },
                  ].map(({ label, rate }) => (
                    <div key={label} className="text-center p-2 rounded-lg bg-slate-50/80">
                      <div className={`text-lg font-black tabular-nums ${rate > 30 ? 'text-green-600' : rate > 15 ? 'text-amber-600' : 'text-slate-500'}`}>{rate}%</div>
                      <div className="text-[9px] font-bold text-slate-400 uppercase leading-tight">{label}</div>
                    </div>
                  ))
                })()}
              </div>
            </div>

            {/* Revenue */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="p-4 rounded-xl bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100/50">
                <div className="text-[10px] font-bold text-green-600 uppercase tracking-wider mb-1">Revenue</div>
                <div className="text-2xl font-black text-green-600 tabular-nums">
                  ${((financials?.total.revenue || 0) / 1000).toFixed(financials?.total.revenue ? 1 : 0)}{(financials?.total.revenue || 0) >= 1000 ? 'k' : ''}
                </div>
                <div className="text-[10px] text-green-500 mt-0.5">{(financials?.total.revenue || 0) > 0 ? 'Total earned' : 'No closings yet'}</div>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100/50">
                <div className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-1">Expenses</div>
                <div className="text-2xl font-black text-orange-600 tabular-nums">
                  ${((financials?.total.expenses || 1775) / 1000).toFixed(1)}k
                </div>
                <div className="text-[10px] text-orange-500 mt-0.5">{financials?.total.expenses ? 'Total spent' : 'Office + travel'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ TASKS + HOT LEADS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Tasks */}
        <div>
          <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
            <Icon name="checklist" className="text-sm" /> Upcoming Tasks
          </h3>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {tasks.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-3">
                  <Icon name="task_alt" className="text-slate-300 text-2xl" />
                </div>
                <div className="text-sm font-semibold text-slate-400">No pending tasks</div>
                <div className="text-[10px] text-slate-300 mt-0.5">You&apos;re all caught up</div>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {tasks.map((task) => (
                  <div key={task.id} className="px-5 py-4 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ring-4 ${
                      task.status === 'overdue' ? 'bg-red-500 ring-red-100' :
                      task.priority === 'high' ? 'bg-orange-500 ring-orange-100' : 'bg-blue-400 ring-blue-50'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-700 truncate">{task.title}</div>
                      <div className="text-[10px] text-slate-400">
                        {task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No due date'}
                        {task.status === 'overdue' && <span className="ml-1.5 text-red-500 font-black bg-red-50 px-1.5 py-0.5 rounded">OVERDUE</span>}
                      </div>
                    </div>
                    <Icon name="chevron_right" className="text-slate-200 text-sm" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Hot Leads */}
        <div>
          <h3 className="text-xs font-black text-red-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
            <Icon name="local_fire_department" className="text-sm" /> Recent Hot Leads
          </h3>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {hotLeads.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-3">
                  <Icon name="local_fire_department" className="text-red-200 text-2xl" />
                </div>
                <div className="text-sm font-semibold text-slate-400">No hot leads</div>
                <div className="text-[10px] text-slate-300 mt-0.5">Keep dialing!</div>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {hotLeads.map((lead) => (
                  <a
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="px-5 py-4 flex items-center gap-3 hover:bg-red-50/30 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 text-white flex items-center justify-center text-sm font-black flex-shrink-0 shadow-md shadow-red-500/20">
                      {(lead.full_name?.[0] || '?').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-700 truncate group-hover:text-red-600 transition-colors">
                        {lead.full_name || 'Unknown'}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-2">
                        <span>{formatPhone(lead.phone)}</span>
                        {lead.source && <span className="bg-red-50 text-red-500 px-1.5 py-0.5 rounded text-[9px] font-bold">{lead.source}</span>}
                      </div>
                    </div>
                    <Icon name="chevron_right" className="text-slate-200 text-sm group-hover:text-red-400 transition-colors" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
