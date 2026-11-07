'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'

type Severity = 'critical' | 'warning' | 'attention' | 'ok'

interface CommandMetric {
  label: string
  value: string
  detail: string
  tone: Severity
}

interface CommandException {
  id: string
  severity: Severity
  title: string
  count: number
  detail: string
  href: string | null
}

interface QueueItem {
  id: string
  title: string
  owner: string
  dueAt: string | null
  status: string
  source: string
  leadId: string | null
}

interface WorkerItem {
  id: string | null
  name: string
  status: string
  type: string
  lastRun: string | null
  lastSuccess: string | null
  failureCount: number
}

interface HotLead {
  id: string | null
  name: string
  address: string
  station: string
  priority: string
  updatedAt: string | null
}

interface UnmatchedComm {
  id: string | null
  type: string
  phone: string
  description: string
  createdAt: string | null
}

interface WebsiteCheck {
  id: string
  target: string
  status: string
  detail: string
  checkedAt: string | null
}

interface CommandCenterData {
  generatedAt: string
  metrics: CommandMetric[]
  business: {
    activeLeads: number
    totalLeadsLoaded: number
    hotLeads: HotLead[]
  }
  communications: {
    inboundSms24: number
    outboundSms24: number
    calls24: number
    recordings24: number
    failedSms7d: number
    unmatched: number
    latestUnmatched: UnmatchedComm[]
  }
  exceptions: CommandException[]
  humanQueue: QueueItem[]
  automation: {
    total: number
    unhealthy: number
    missingRunProof: number
    workers: WorkerItem[]
  }
  website: {
    installed: boolean
    checks: WebsiteCheck[]
  }
  proof: {
    openNotifications: number
    badNumberLeads: number
    loadedRows: Record<string, number>
  }
}

function toneClasses(tone: Severity): string {
  if (tone === 'critical') return 'border-red-500/30 bg-red-500/10 text-red-100'
  if (tone === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-100'
  if (tone === 'attention') return 'border-blue-500/30 bg-blue-500/10 text-blue-100'
  return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
}

function dotClass(tone: Severity): string {
  if (tone === 'critical') return 'bg-red-400'
  if (tone === 'warning') return 'bg-amber-300'
  if (tone === 'attention') return 'bg-blue-300'
  return 'bg-emerald-300'
}

function relativeTime(value: string | null): string {
  if (!value) return 'No proof'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'Unknown'
  const mins = Math.max(0, Math.floor((Date.now() - time) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function dueLabel(value: string | null): string {
  if (!value) return 'No due date'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unknown due date'
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function severityFromStatus(status: string): Severity {
  const s = status.toLowerCase()
  if (['down', 'failed', 'missing'].includes(s)) return 'critical'
  if (['degraded', 'unknown', 'overdue'].includes(s)) return 'warning'
  if (['scheduled', 'pending'].includes(s)) return 'attention'
  return 'ok'
}

function LoadingSkeleton() {
  return (
    <div className="lead-cockpit min-h-screen px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="h-24 animate-pulse rounded-lg bg-[color:var(--ck-surface)]" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-[color:var(--ck-surface)]" />)}
        </div>
        <div className="h-[520px] animate-pulse rounded-lg bg-[color:var(--ck-surface)]" />
      </div>
    </div>
  )
}

export function OpsCommandCenter() {
  const [data, setData] = useState<CommandCenterData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/ops/command-center', { cache: 'no-store' })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Failed to load command center')
        if (!cancelled) {
          setData(body)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const topException = useMemo(() => {
    if (!data) return null
    return data.exceptions.find((item) => item.severity === 'critical') ||
      data.exceptions.find((item) => item.severity === 'warning') ||
      data.exceptions.find((item) => item.severity === 'attention') ||
      data.exceptions[0] ||
      null
  }, [data])

  if (loading) return <LoadingSkeleton />

  if (error || !data) {
    return (
      <div className="lead-cockpit min-h-screen px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-red-100">
          <p className="text-sm font-black uppercase tracking-wider">Command center offline</p>
          <p className="mt-2 text-sm font-semibold">{error || 'No data returned'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="lead-cockpit min-h-screen px-4 pb-16 pt-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <section className="grid grid-cols-1 gap-4 border-b border-[color:var(--ck-border)] pb-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${topException ? dotClass(topException.severity) : 'bg-emerald-300'}`} />
              <p className="ck-microlabel">Saving KC Command</p>
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Operator Cockpit
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-[color:var(--ck-text-muted)]">
              {topException ? `${topException.title}: ${topException.detail}` : 'No active exception loaded.'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)] p-3">
              <p className="text-2xl font-black text-white">{data.proof.openNotifications}</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[color:var(--ck-text-muted)]">alerts</p>
            </div>
            <div className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)] p-3">
              <p className="text-2xl font-black text-white">{data.communications.unmatched}</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[color:var(--ck-text-muted)]">unmatched</p>
            </div>
            <div className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)] p-3">
              <p className="text-2xl font-black text-white">{data.automation.unhealthy}</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[color:var(--ck-text-muted)]">down</p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {data.metrics.map((metric) => (
            <div key={metric.label} className={`rounded-lg border p-4 ${toneClasses(metric.tone)}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-wider opacity-80">{metric.label}</p>
                <span className={`mt-1 h-2 w-2 rounded-full ${dotClass(metric.tone)}`} />
              </div>
              <p className="mt-3 text-3xl font-black tracking-tight text-white">{metric.value}</p>
              <p className="mt-1 text-xs font-semibold opacity-80">{metric.detail}</p>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <div className="space-y-4">
            <section className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)]">
              <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ck-border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Icon name="emergency_home" size="text-base" className="text-[color:var(--ck-accent-bright)]" />
                  <h2 className="text-sm font-black uppercase tracking-wider text-white">Exception Command</h2>
                </div>
                <span className="text-xs font-bold text-[color:var(--ck-text-muted)]">{data.exceptions.filter((item) => item.severity !== 'ok').length} active</span>
              </div>
              <div className="divide-y divide-[color:var(--ck-border)]">
                {data.exceptions.map((item) => {
                  const content = (
                    <div className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(item.severity)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-black text-white">{item.title}</p>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${toneClasses(item.severity)}`}>
                            {item.count}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-[color:var(--ck-text-muted)]">{item.detail}</p>
                      </div>
                      {item.href && <Icon name="arrow_forward" size="text-sm" className="mt-1 shrink-0 text-[color:var(--ck-text-dim)]" />}
                    </div>
                  )
                  return item.href ? <Link key={item.id} href={item.href}>{content}</Link> : <div key={item.id}>{content}</div>
                })}
              </div>
            </section>

            <section className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)]">
              <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ck-border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Icon name="task_alt" size="text-base" className="text-[color:var(--ck-accent-bright)]" />
                  <h2 className="text-sm font-black uppercase tracking-wider text-white">Human Work Queue</h2>
                </div>
                <Link href="/leads" className="text-xs font-black text-[color:var(--ck-accent-bright)]">Open leads</Link>
              </div>
              <div className="divide-y divide-[color:var(--ck-border)]">
                {data.humanQueue.length === 0 ? (
                  <p className="px-4 py-5 text-sm font-semibold text-[color:var(--ck-text-muted)]">No pending tasks loaded.</p>
                ) : data.humanQueue.map((task) => (
                  <div key={`${task.source}-${task.id}`} className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_160px_120px] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{task.title}</p>
                      <p className="mt-1 text-xs font-medium text-[color:var(--ck-text-muted)]">{task.owner} · {task.source}</p>
                    </div>
                    <p className="text-xs font-bold text-[color:var(--ck-text-muted)]">{dueLabel(task.dueAt)}</p>
                    <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${toneClasses(severityFromStatus(task.status))}`}>
                      {task.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)]">
              <div className="border-b border-[color:var(--ck-border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Icon name="forum" size="text-base" className="text-[color:var(--ck-accent-bright)]" />
                  <h2 className="text-sm font-black uppercase tracking-wider text-white">Communication Hub</h2>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-[color:var(--ck-border)]">
                {[
                  ['Inbound SMS', data.communications.inboundSms24],
                  ['Outbound SMS', data.communications.outboundSms24],
                  ['Calls', data.communications.calls24],
                  ['Recordings', data.communications.recordings24],
                ].map(([label, value]) => (
                  <div key={label} className="bg-[color:var(--ck-surface)] p-4">
                    <p className="text-2xl font-black text-white">{value}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[color:var(--ck-text-muted)]">{label}</p>
                  </div>
                ))}
              </div>
              <div className="divide-y divide-[color:var(--ck-border)]">
                {data.communications.latestUnmatched.length === 0 ? (
                  <p className="px-4 py-4 text-xs font-semibold text-[color:var(--ck-text-muted)]">No unmatched comms loaded.</p>
                ) : data.communications.latestUnmatched.map((item) => (
                  <div key={item.id || `${item.phone}-${item.createdAt}`} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-wider text-white">{item.type} · {item.phone}</p>
                      <span className="text-[10px] font-bold text-[color:var(--ck-text-dim)]">{relativeTime(item.createdAt)}</span>
                    </div>
                    {item.description && <p className="mt-1 line-clamp-2 text-xs font-medium text-[color:var(--ck-text-muted)]">{item.description}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)]">
              <div className="border-b border-[color:var(--ck-border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Icon name="precision_manufacturing" size="text-base" className="text-[color:var(--ck-accent-bright)]" />
                  <h2 className="text-sm font-black uppercase tracking-wider text-white">Automation Factory</h2>
                </div>
              </div>
              <div className="divide-y divide-[color:var(--ck-border)]">
                {data.automation.workers.map((worker) => {
                  const severity = severityFromStatus(worker.status)
                  return (
                    <div key={worker.id || worker.name} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">{worker.name}</p>
                          <p className="mt-1 text-xs font-medium text-[color:var(--ck-text-muted)]">{worker.type} · last run {relativeTime(worker.lastRun || worker.lastSuccess)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${toneClasses(severity)}`}>
                          {worker.status}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)]">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ck-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <Icon name="local_fire_department" size="text-base" className="text-[color:var(--ck-accent-bright)]" />
                <h2 className="text-sm font-black uppercase tracking-wider text-white">Lead / Deal Operating System</h2>
              </div>
              <span className="text-xs font-bold text-[color:var(--ck-text-muted)]">{data.business.activeLeads} active / {data.business.totalLeadsLoaded} loaded</span>
            </div>
            <div className="divide-y divide-[color:var(--ck-border)]">
              {data.business.hotLeads.length === 0 ? (
                <p className="px-4 py-5 text-sm font-semibold text-[color:var(--ck-text-muted)]">No hot leads loaded.</p>
              ) : data.business.hotLeads.map((lead) => (
                <Link key={lead.id || lead.name} href={lead.id ? `/leads/${lead.id}` : '/leads'} className="grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-white/[0.03] md:grid-cols-[minmax(0,1fr)_120px_120px] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{lead.name}</p>
                    <p className="mt-1 truncate text-xs font-medium text-[color:var(--ck-text-muted)]">{lead.address || 'No address'}</p>
                  </div>
                  <span className="w-fit rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-blue-100">
                    {lead.station}
                  </span>
                  <p className="text-xs font-bold text-[color:var(--ck-text-muted)]">{relativeTime(lead.updatedAt)}</p>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)]">
            <div className="border-b border-[color:var(--ck-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <Icon name="dns" size="text-base" className="text-[color:var(--ck-accent-bright)]" />
                <h2 className="text-sm font-black uppercase tracking-wider text-white">Website / Domain Health</h2>
              </div>
            </div>
            <div className="divide-y divide-[color:var(--ck-border)]">
              {data.website.checks.map((check) => {
                const severity = severityFromStatus(check.status)
                return (
                  <div key={check.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-white">{check.target}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${toneClasses(severity)}`}>
                        {check.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-[color:var(--ck-text-muted)]">{check.detail}</p>
                  </div>
                )
              })}
            </div>
          </section>
        </section>

        <section className="rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold text-[color:var(--ck-text-muted)]">
            <span>Refreshed {relativeTime(data.generatedAt)}</span>
            {Object.entries(data.proof.loadedRows).map(([key, value]) => (
              <span key={key}>{key}: {value}</span>
            ))}
            <span>bad numbers: {data.proof.badNumberLeads}</span>
          </div>
        </section>
      </div>
    </div>
  )
}
