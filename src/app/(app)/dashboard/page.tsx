'use client'

import { useEffect, useState, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { useFinancials } from '@/hooks/use-financials'
import { BottleneckCalculator } from './components/BottleneckCalculator'

// ─── Types ───────────────────────────────────────────────────────
interface LeadCounts {
  total: number
  byStation: Record<string, number>
  daysSinceLastContract: number | null
}

interface YtdKpis {
  agent: string
  monthly: { month: string; dialTimeHrs: number; calls: number; contacts: number; leads: number; appointments: number }[]
  ytd: { dialTimeHrs: number; calls: number; contacts: number; leads: number; appointments: number; contactRate: string; leadRate: string; months: number }
}

interface AppointmentStats {
  showRate30Day: number
  totalAppointments: number
  completed: number
  noShows: number
  cancelled: number
  ghostProtocolRecoveryRate: number
}

// ─── Helpers ─────────────────────────────────────────────────────
function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function moneyShort(amount: number): string {
  const abs = Math.abs(amount)
  if (abs >= 1000) return `${amount < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`
  return `${amount < 0 ? '-' : ''}$${abs}`
}

// Animated counter — eases from prior value to new value
function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<number>(0)

  useEffect(() => {
    let frame = 0
    if (value === 0) {
      frame = requestAnimationFrame(() => {
        setDisplay(0)
        ref.current = 0
      })
      return () => cancelAnimationFrame(frame)
    }
    const start = ref.current
    const diff = value - start
    const startTime = performance.now()

    function tick(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + diff * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
      else ref.current = value
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  return <>{display}</>
}

function ProgressRing({ value, max, size = 72, stroke = 6, color = '#16a34a' }: { value: number; max: number; size?: number; stroke?: number; color?: string }) {
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

// ─── Data hooks ──────────────────────────────────────────────────
function useLeadCounts() {
  const [data, setData] = useState<LeadCounts | null>(null)
  useEffect(() => {
    const supabase = createClient()
    supabase.from('leads').select('station, created_at').then(({ data: rows }) => {
      if (!rows) return
      const byStation: Record<string, number> = {}
      let lastContractDate: string | null = null
      for (const row of rows) {
        const s = row.station || 'unknown'
        byStation[s] = (byStation[s] || 0) + 1
        if (s === 'contract_signed') {
          if (!lastContractDate || row.created_at > lastContractDate) lastContractDate = row.created_at
        }
      }
      setData({ total: rows.length, byStation, daysSinceLastContract: daysSince(lastContractDate) })
    })
  }, [])
  return data
}

function useYtdKpis() {
  const [data, setData] = useState<YtdKpis | null>(null)
  useEffect(() => { fetch('/api/dashboard/kpis').then((r) => r.json()).then(setData).catch(() => {}) }, [])
  return data
}

function useAppointmentStats() {
  const [data, setData] = useState<AppointmentStats | null>(null)
  useEffect(() => { fetch('/api/dashboard/appointment-stats').then((r) => r.json()).then(setData).catch(() => {}) }, [])
  return data
}

// ─── Page ────────────────────────────────────────────────────────
export default function KpiPage() {
  const leadCounts = useLeadCounts()
  const ytd = useYtdKpis()
  const apptStats = useAppointmentStats()
  const { data: financials } = useFinancials()

  const total = leadCounts?.total || 0
  const qualified = (leadCounts?.byStation?.qualified ?? 0) + (leadCounts?.byStation?.appointment_set ?? 0) + (leadCounts?.byStation?.offer_made ?? 0) + (leadCounts?.byStation?.under_contract ?? 0)
  const offered = (leadCounts?.byStation?.offer_made ?? 0) + (leadCounts?.byStation?.under_contract ?? 0)
  const closed = leadCounts?.byStation?.under_contract ?? 0
  const qRate = total > 0 ? Math.round((qualified / total) * 100) : 0
  const oRate = qualified > 0 ? Math.round((offered / qualified) * 100) : 0
  const cRate = offered > 0 ? Math.round((closed / offered) * 100) : 0

  const revenue = financials?.total?.revenue ?? 0
  const expenses = financials?.total?.expenses ?? 0
  const net = revenue - expenses

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] mx-auto w-full space-y-8 pb-32">
      {/* Header */}
      <div>
        <span className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-1 block">
          KPIs
        </span>
        <h2 className="text-3xl font-extrabold tracking-tight text-primary">
          {ytd?.agent ? `${ytd.agent} — Year to Date` : 'Year to Date'}
        </h2>
      </div>

      <BottleneckCalculator />

      {/* ═══ Hero row — Dials / Appointments / Revenue ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HeroCard
          icon="phone_in_talk"
          label="Dials YTD"
          value={ytd?.ytd.calls ?? 0}
          sub={ytd ? `${ytd.ytd.dialTimeHrs.toFixed(0)} hrs · ${(ytd.ytd.dialTimeHrs / Math.max(ytd.ytd.months, 1)).toFixed(1)}h/mo avg` : ''}
        />
        <HeroCard
          icon="event_available"
          label="Appointments YTD"
          value={ytd?.ytd.appointments ?? 0}
          sub={ytd ? `${ytd.ytd.contactRate}% contact · ${ytd.ytd.leadRate}% lead rate` : ''}
          accent
        />
        <HeroCard
          icon="payments"
          label="Revenue YTD"
          moneyValue={revenue}
          sub={leadCounts?.daysSinceLastContract != null
            ? leadCounts.daysSinceLastContract > 30
              ? `${leadCounts.daysSinceLastContract} days since last close — time to land one`
              : `${leadCounts.daysSinceLastContract} days since last close`
            : 'No closings yet'}
        />
      </div>

      {/* ═══ Monthly funnel bars ═══ */}
      {ytd && ytd.monthly.length > 0 && (
        <div>
          <SectionHeader icon="bar_chart" label="Monthly Funnel" />
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="space-y-3">
              {ytd.monthly.map((m) => {
                const maxCalls = Math.max(...ytd.monthly.map(x => x.calls))
                return (
                  <div key={m.month} className="flex items-center gap-3">
                    <div className="w-16 text-xs font-bold text-slate-500">{m.month.replace(' 2026', '')}</div>
                    <div className="flex-1 h-8 bg-slate-50 rounded-lg overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-[#E32E2E] to-[#C42626] rounded-lg transition-all duration-1000 ease-out flex items-center justify-end pr-3"
                        style={{ width: `${maxCalls > 0 ? (m.calls / maxCalls) * 100 : 0}%` }}
                      >
                        <span className="text-[10px] font-black text-white tabular-nums">{m.calls.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="w-32 text-right text-[10px]">
                      <span className="font-bold text-emerald-600 tabular-nums">{m.contacts}</span>
                      <span className="text-slate-400"> contacts · </span>
                      <span className="font-bold text-amber-600 tabular-nums">{m.leads}</span>
                      <span className="text-slate-400"> leads</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ 3-col tiles: Show Rate / Conversion / Financial ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 30-day show rate */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Icon name="percent" size="text-xs" /> 30-Day Show Rate
          </div>
          {apptStats !== null && apptStats.totalAppointments > 0 ? (
            <>
              <div className="flex items-center gap-4 mb-4">
                <div className="relative flex items-center justify-center">
                  <ProgressRing
                    value={apptStats.showRate30Day}
                    max={100}
                    size={72}
                    stroke={6}
                    color={apptStats.showRate30Day >= 90 ? '#16a34a' : apptStats.showRate30Day >= 85 ? '#f59e0b' : '#E32E2E'}
                  />
                  <span className="absolute text-lg font-black text-primary tabular-nums">{apptStats.showRate30Day}%</span>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Target 90%+</div>
                  <div className="text-sm font-semibold text-slate-700 mt-1">
                    {apptStats.showRate30Day >= 90 ? 'On target' : apptStats.showRate30Day >= 85 ? 'Close' : 'Below target'}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100">
                <StatTile label="Complete" value={apptStats.completed} color="text-emerald-600" />
                <StatTile label="No-Shows" value={apptStats.noShows} color="text-[#E32E2E]" />
                <StatTile label="Cancel" value={apptStats.cancelled} color="text-slate-500" />
              </div>
              {apptStats.ghostProtocolRecoveryRate > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 text-[10px] text-slate-500 flex items-center gap-1.5">
                  <Icon name="visibility_off" size="text-xs" />
                  Ghost Protocol recovered <span className="font-bold text-slate-700 tabular-nums">{apptStats.ghostProtocolRecoveryRate}%</span>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-slate-400 py-4">No appointments yet</div>
          )}
        </div>

        {/* Conversion funnel */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Icon name="filter_alt" size="text-xs" /> Conversion Funnel
          </div>
          <div className="space-y-4">
            <FunnelRow label="Lead → Qualified" pct={qRate} />
            <FunnelRow label="Qualified → Offer" pct={oRate} />
            <FunnelRow label="Offer → Close" pct={cRate} />
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-500 tabular-nums">
            {total.toLocaleString()} total · {closed} closed
          </div>
        </div>

        {/* Financial health */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Icon name="account_balance" size="text-xs" /> Financial Health
          </div>
          <div className="space-y-3">
            <FinancialRow label="Revenue" value={revenue} tone="positive" />
            <FinancialRow label="Expenses" value={expenses} tone="negative" />
            <FinancialRow label="Net" value={net} tone="neutral" emphasis />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Presentational ──────────────────────────────────────────────
function SectionHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
      <Icon name={icon} size="text-sm" /> {label}
    </h3>
  )
}

function HeroCard({
  icon,
  label,
  value,
  moneyValue,
  sub,
  accent,
}: {
  icon: string
  label: string
  value?: number
  moneyValue?: number
  sub?: string
  accent?: boolean
}) {
  const body = accent
    ? 'bg-gradient-to-br from-[#E32E2E] to-[#C42626] border-[#C42626] text-white'
    : 'bg-white border-slate-200 text-primary'
  const labelTone = accent ? 'text-white/80' : 'text-slate-400'
  const subTone = accent ? 'text-white/70' : 'text-slate-400'
  const iconBg = accent ? 'bg-white/15' : 'bg-slate-50'
  const iconTone = accent ? 'text-white/90' : 'text-slate-500'

  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 shadow-sm border ${body}`}>
      <div className={`absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center ${iconBg}`}>
        <Icon name={icon} size="text-lg" className={iconTone} />
      </div>
      <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${labelTone}`}>{label}</div>
      <div className="text-4xl font-black tabular-nums">
        {moneyValue !== undefined ? moneyShort(moneyValue) : <AnimatedNumber value={value ?? 0} />}
      </div>
      {sub && <div className={`text-[10px] mt-2 ${subTone}`}>{sub}</div>}
    </div>
  )
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-black tabular-nums ${color}`}><AnimatedNumber value={value} /></div>
      <div className="text-[9px] font-bold text-slate-400 uppercase">{label}</div>
    </div>
  )
}

function FunnelRow({ label, pct }: { label: string; pct: number }) {
  const color = pct > 30 ? 'bg-emerald-500' : pct > 15 ? 'bg-amber-500' : 'bg-slate-400'
  const pctColor = pct > 30 ? 'text-emerald-600' : pct > 15 ? 'text-amber-600' : 'text-slate-500'
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
        <span className={`text-sm font-black tabular-nums ${pctColor}`}>{pct}%</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  )
}

function FinancialRow({ label, value, tone, emphasis }: { label: string; value: number; tone: 'positive' | 'negative' | 'neutral'; emphasis?: boolean }) {
  const colorClass = tone === 'positive'
    ? 'text-emerald-600'
    : tone === 'negative'
    ? 'text-[#E32E2E]'
    : value >= 0 ? 'text-slate-700' : 'text-[#E32E2E]'

  return (
    <div className={`flex items-baseline justify-between ${emphasis ? 'pt-2 border-t border-slate-100' : ''}`}>
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`font-black tabular-nums ${emphasis ? 'text-lg' : 'text-sm'} ${colorClass}`}>
        {moneyShort(value)}
      </span>
    </div>
  )
}
