'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Icon } from '@/components/ui/icon'
import { ScNav } from '@/components/smartercontact/sc-nav'

type Tab = 'messaging' | 'calling'

interface MessagingMetrics {
  sms_sent: number
  segments_sent: number
  delivered: number
  delivery_rate: number
  blocked: number
  carrier_block_rate: number
  replies_received: number
  reply_rate: number
  opt_outs: number
  opt_out_rate: number
  median_response_time_min: number
  contacts: number
  leads: number
  sms_to_lead_rate: number
  contact_to_lead_rate: number
}

interface CallingMetrics {
  calls_made: number
  connected: number
  connect_rate: number
  missed: number
  inbound: number
  outbound: number
  total_talk_time_min: number
  avg_call_length_min: number
  note: string | null
}

interface SeriesPoint {
  date: string
  sent: number
  delivered: number
  replies: number
}

interface Campaign {
  id: string
  name: string
}
interface Template {
  id: string
  name: string
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function num(n: number): string {
  return n.toLocaleString()
}

interface StatCardProps {
  icon: string
  label: string
  value: string
}
function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
      <div className="flex items-center gap-2 text-[var(--ck-text-dim)]">
        <Icon name={icon} size="text-lg" className="text-[#E32E2E]" />
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </div>
  )
}

export default function ReportingPage() {
  const [tab, setTab] = useState<Tab>('messaging')
  const [from, setFrom] = useState(isoDaysAgo(7))
  const [to, setTo] = useState(todayIso())
  const [campaignId, setCampaignId] = useState('')
  const [templateId, setTemplateId] = useState('')

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [templates, setTemplates] = useState<Template[]>([])

  const [messaging, setMessaging] = useState<MessagingMetrics | null>(null)
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [calling, setCalling] = useState<CallingMetrics | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Load filter options once.
  useEffect(() => {
    fetch('/api/sc/campaigns?status=all')
      .then((r) => r.json())
      .then((j) => setCampaigns((j.campaigns || []).map((c: any) => ({ id: c.id, name: c.name }))))
      .catch(() => {})
    fetch('/api/sms-templates')
      .then((r) => r.json())
      .then((j) => setTemplates((j.templates || []).map((t: any) => ({ id: t.id, name: t.name }))))
      .catch(() => {})
  }, [])

  const queryString = useMemo(() => {
    const p = new URLSearchParams({ tab, from, to })
    if (campaignId) p.set('campaign_id', campaignId)
    if (templateId) p.set('template_id', templateId)
    return p.toString()
  }, [tab, from, to, campaignId, templateId])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/sc/reporting?${queryString}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to load report')
        return
      }
      if (tab === 'messaging') {
        setMessaging(json.metrics)
        setSeries(json.series || [])
      } else {
        setCalling(json.metrics)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [queryString, tab])

  useEffect(() => {
    load()
  }, [load])

  function exportCsv() {
    const p = new URLSearchParams({ tab, from, to, format: 'csv' })
    if (campaignId) p.set('campaign_id', campaignId)
    if (templateId) p.set('template_id', templateId)
    // Navigate to trigger the attachment download.
    window.location.href = `/api/sc/reporting?${p.toString()}`
  }

  return (
    <div className="flex flex-col h-full">
      <ScNav />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--ck-border)] px-4">
        {(['messaging', 'calling'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-bold capitalize border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-[#E32E2E] text-white'
                : 'border-transparent text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--ck-border)] p-4">
        <label className="flex flex-col gap-1 text-xs text-[var(--ck-text-dim)]">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm text-[var(--ck-text)] outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--ck-text-dim)]">
          To
          <input
            type="date"
            value={to}
            min={from}
            max={todayIso()}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm text-[var(--ck-text)] outline-none"
          />
        </label>

        {tab === 'messaging' && (
          <>
            <label className="flex flex-col gap-1 text-xs text-[var(--ck-text-dim)]">
              Campaign
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm text-[var(--ck-text)] outline-none min-w-40"
              >
                <option value="">All campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--ck-text-dim)]">
              Template
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm text-[var(--ck-text)] outline-none min-w-40"
              >
                <option value="">All templates</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <button
          onClick={exportCsv}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#E32E2E] px-4 py-2 text-sm font-bold text-white hover:bg-[#c72828]"
        >
          <Icon name="download" size="text-lg" />
          Export to CSV
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-4 rounded-lg bg-[#E32E2E]/10 px-4 py-3 text-sm text-[#E32E2E]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-6 text-sm text-[var(--ck-text-dim)]">Loading…</div>
        ) : tab === 'messaging' ? (
          <MessagingView metrics={messaging} series={series} />
        ) : (
          <CallingView metrics={calling} />
        )}
      </div>
    </div>
  )
}

function MessagingView({
  metrics,
  series,
}: {
  metrics: MessagingMetrics | null
  series: SeriesPoint[]
}) {
  if (!metrics) return <div className="text-sm text-[var(--ck-text-dim)]">No data</div>

  const cards: StatCardProps[] = [
    { icon: 'send', label: 'SMS Sent', value: num(metrics.sms_sent) },
    { icon: 'segment', label: 'Segments Sent', value: num(metrics.segments_sent) },
    { icon: 'block', label: 'Carrier Block Rate', value: pct(metrics.carrier_block_rate) },
    { icon: 'reply', label: 'Replies Received', value: num(metrics.replies_received) },
    { icon: 'task_alt', label: 'Delivery Rate', value: pct(metrics.delivery_rate) },
    { icon: 'unsubscribe', label: 'Opt-out Rate', value: pct(metrics.opt_out_rate) },
    { icon: 'forum', label: 'Reply Rate', value: pct(metrics.reply_rate) },
    {
      icon: 'timer',
      label: 'Median Response Time',
      value: `${metrics.median_response_time_min} min`,
    },
    { icon: 'trending_up', label: 'Leads', value: num(metrics.leads) },
    { icon: 'contacts', label: 'Contacts', value: num(metrics.contacts) },
    { icon: 'call_split', label: 'SMS-to-Lead Rate', value: pct(metrics.sms_to_lead_rate) },
    { icon: 'group_add', label: 'Contact-to-Lead Rate', value: pct(metrics.contact_to_lead_rate) },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>

      <div className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
        <h3 className="mb-4 text-sm font-bold text-white">Daily activity</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E32E2E" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#E32E2E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--ck-text-dim)', fontSize: 11 }}
                tickFormatter={(d: string) => d.slice(5)}
                stroke="var(--ck-border)"
              />
              <YAxis
                tick={{ fill: 'var(--ck-text-dim)', fontSize: 11 }}
                stroke="var(--ck-border)"
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--ck-bg)',
                  border: '1px solid var(--ck-border)',
                  borderRadius: 8,
                  color: 'var(--ck-text)',
                  fontSize: 12,
                }}
                labelStyle={{ color: 'var(--ck-text-muted)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--ck-text-muted)' }} />
              <Area
                type="monotone"
                dataKey="sent"
                name="Sent"
                stroke="#E32E2E"
                strokeWidth={2}
                fill="url(#gSent)"
              />
              <Line
                type="monotone"
                dataKey="delivered"
                name="Delivered"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="replies"
                name="Replies"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function CallingView({ metrics }: { metrics: CallingMetrics | null }) {
  if (!metrics) return <div className="text-sm text-[var(--ck-text-dim)]">No data</div>

  const cards: StatCardProps[] = [
    { icon: 'call', label: 'Calls Made', value: num(metrics.calls_made) },
    { icon: 'call_received', label: 'Connected', value: num(metrics.connected) },
    { icon: 'percent', label: 'Connect Rate', value: pct(metrics.connect_rate) },
    { icon: 'phone_missed', label: 'Missed', value: num(metrics.missed) },
    { icon: 'call_received', label: 'Inbound', value: num(metrics.inbound) },
    { icon: 'call_made', label: 'Outbound', value: num(metrics.outbound) },
    {
      icon: 'schedule',
      label: 'Total Talk Time',
      value: `${metrics.total_talk_time_min} min`,
    },
    {
      icon: 'timer',
      label: 'Avg Call Length',
      value: `${metrics.avg_call_length_min} min`,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {metrics.note && (
        <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-4 py-3 text-sm text-[var(--ck-text-muted)]">
          <Icon name="info" size="text-base" className="mr-1.5 align-middle text-[var(--ck-text-dim)]" />
          {metrics.note}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>
    </div>
  )
}
