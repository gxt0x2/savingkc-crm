'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type LeadAlertSummary = {
  total: number
  smsSucceeded: number
  smsFailed: number
  callbacksStarted: number
  callbacksClaimed: number
  callbacksConnected: number
  noRecipients: number
  ernestIncluded: number
  caseyIncluded: number
  googleAds: number
  formAlerts: number
  callAlerts: number
}

type LeadAlertItem = {
  id: string
  leadId: string | null
  leadName: string
  leadPhoneDisplay: string | null
  leadUrl: string | null
  leadSource: string | null
  leadStation: string | null
  leadPriority: string | null
  propertyAddress: string | null
  city: string | null
  state: string | null
  classification: string | null
  opportunityScore: number | null
  trigger: string | null
  triggerLabel: string
  channel: 'form' | 'call' | 'sms' | 'booking' | 'other'
  source: string | null
  trafficSource: string | null
  campaign: string | null
  createdAt: string
  description: string | null
  recipients: string[]
  delivery: Array<{
    target: string | null
    to: string | null
    toDisplay: string | null
    success: boolean
    sid: string | null
    error: string | null
    status: string | null
  }>
  smsSucceeded: number
  smsFailed: number
  callback: {
    started: boolean
    sid: string | null
    to: string | null
    toDisplay: string | null
    batchId: string | null
    calls: Array<{
      agentName: string | null
      to: string | null
      toDisplay: string | null
      started: boolean
      sid: string | null
      error: string | null
    }>
    error: string | null
    claimedBy: string | null
    claimedAt: string | null
    outcome: 'connected' | 'missed' | null
    outcomeAt: string | null
    dialStatus: string | null
  } | null
}

type LeadAlertsResponse = {
  generatedAt: string
  filters: {
    days: number
    since: string
  }
  summary: LeadAlertSummary
  alerts: LeadAlertItem[]
}

type AlertFilter = 'all' | 'failures' | 'callbacks' | 'google_ads' | 'form' | 'call' | 'casey'

const DAY_OPTIONS = [
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 30, label: '30d' },
] as const

const FILTERS: Array<{ value: AlertFilter; label: string }> = [
  { value: 'all', label: 'All alerts' },
  { value: 'failures', label: 'Failures' },
  { value: 'callbacks', label: 'Callbacks' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'form', label: 'Forms' },
  { value: 'call', label: 'Calls' },
  { value: 'casey', label: 'Casey included' },
]

function formatDateTime(value: string | null): string {
  if (!value) return 'Not recorded'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function locationLine(row: LeadAlertItem): string {
  const parts = [row.propertyAddress, row.city, row.state].filter(Boolean)
  if (parts.length) return parts.join(', ')
  return row.leadPhoneDisplay || row.leadSource || 'No lead details'
}

function channelLabel(channel: LeadAlertItem['channel']): string {
  if (channel === 'sms') return 'SMS'
  return channel.charAt(0).toUpperCase() + channel.slice(1)
}

function callbackStatus(row: LeadAlertItem): string {
  if (!row.callback) return 'No callback'
  if (!row.callback.started) return row.callback.error || 'Callback did not start'
  if (row.callback.outcome === 'connected') return `Connected${row.callback.claimedBy ? ` by ${row.callback.claimedBy}` : ''}`
  if (row.callback.outcome === 'missed') return `Seller missed${row.callback.claimedBy ? ` after ${row.callback.claimedBy} claimed` : ''}`
  if (row.callback.claimedBy) return `Claimed by ${row.callback.claimedBy}`
  return 'Started, waiting on result'
}

function filterAlert(row: LeadAlertItem, filter: AlertFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'failures') return row.smsFailed > 0 || row.recipients.length === 0 || row.callback?.started === false
  if (filter === 'callbacks') return Boolean(row.callback)
  if (filter === 'google_ads') return row.trafficSource === 'google_ads' || (row.trigger || '').includes('google_ads')
  if (filter === 'form') return row.channel === 'form'
  if (filter === 'call') return row.channel === 'call'
  if (filter === 'casey') return row.recipients.includes('Casey')
  return true
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`alert-stat ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function LeadAlertsPage() {
  const [days, setDays] = useState(14)
  const [filter, setFilter] = useState<AlertFilter>('all')
  const [data, setData] = useState<LeadAlertsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadAlerts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/marketing/lead-alerts?days=${days}`, {
        cache: 'no-store',
        signal,
      })
      if (!response.ok) throw new Error(`Unable to load lead alerts (${response.status})`)
      const payload = await response.json() as LeadAlertsResponse
      setData(payload)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [days])

  useEffect(() => {
    const controller = new AbortController()
    void loadAlerts(controller.signal)
    return () => controller.abort()
  }, [loadAlerts])

  const alerts = useMemo(() => (data?.alerts || []).filter((row) => filterAlert(row, filter)), [data, filter])
  const summary = data?.summary

  return (
    <>
      <style>{LEAD_ALERT_STYLES}</style>
      <main className="lead-alerts" data-theme="dark">
        <div className="alert-wrap">
          <header className="alert-header">
            <div>
              <Link className="back-link" href="/marketing">Ads Command</Link>
              <h1>Lead Alert Audit</h1>
              <p>Every team notification path for form and call leads from the last {days} day{days === 1 ? '' : 's'}.</p>
            </div>
            <button className="refresh-button" type="button" onClick={() => loadAlerts()} disabled={loading}>
              {loading ? 'Refreshing' : 'Refresh'}
            </button>
          </header>

          <section className="alert-stats" aria-label="Lead alert summary">
            <Stat label="Alerts" value={summary?.total ?? '--'} />
            <Stat label="SMS Sent" value={summary?.smsSucceeded ?? '--'} tone="green" />
            <Stat label="SMS Failed" value={summary?.smsFailed ?? '--'} tone={summary?.smsFailed ? 'red' : undefined} />
            <Stat label="Callbacks" value={summary?.callbacksStarted ?? '--'} tone="blue" />
            <Stat label="Claimed" value={summary?.callbacksClaimed ?? '--'} />
            <Stat label="Casey Included" value={summary?.caseyIncluded ?? '--'} />
          </section>

          <section className="alert-controls" aria-label="Lead alert filters">
            <div className="segmented">
              {DAY_OPTIONS.map((option) => (
                <button key={option.value} type="button" className={days === option.value ? 'active' : ''} onClick={() => setDays(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="segmented wide">
              {FILTERS.map((option) => (
                <button key={option.value} type="button" className={filter === option.value ? 'active' : ''} onClick={() => setFilter(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          {error ? <div className="alert-error" role="alert">{error}</div> : null}

          <section className="alert-list" aria-label="Lead alert audit rows">
            {loading && !data ? (
              <div className="alert-empty">Loading alerts.</div>
            ) : alerts.length === 0 ? (
              <div className="alert-empty">No alerts match this view.</div>
            ) : (
              alerts.map((row) => (
                <article className={`alert-row ${row.smsFailed > 0 || row.recipients.length === 0 ? 'has-failure' : ''}`} key={row.id}>
                  <div className="row-main">
                    <div className="row-title">
                      <div>
                        <h2>{row.leadName}</h2>
                        <p>{locationLine(row)}</p>
                      </div>
                      <div className="row-badges">
                        <span className={`channel-pill channel-${row.channel}`}>{channelLabel(row.channel)}</span>
                        {row.trafficSource === 'google_ads' ? <span className="source-pill">Google Ads</span> : null}
                        {row.campaign ? <span className="source-pill">{row.campaign}</span> : null}
                      </div>
                    </div>

                    <div className="alert-meta">
                      <span>{formatDateTime(row.createdAt)}</span>
                      <span>{row.triggerLabel}</span>
                      {row.leadStation ? <span>{row.leadStation.replace(/_/g, ' ')}</span> : null}
                      {row.leadPriority ? <span>{row.leadPriority}</span> : null}
                      {row.opportunityScore !== null ? <span>Score {row.opportunityScore}</span> : null}
                    </div>

                    <div className="recipient-grid" aria-label={`Recipients for ${row.leadName}`}>
                      {row.recipients.length === 0 ? (
                        <span className="recipient-pill failed">No recipients recorded</span>
                      ) : row.recipients.map((recipient) => {
                        const match = row.delivery.find((item) => item.target === recipient)
                        return (
                          <span className={`recipient-pill ${match?.success ? 'sent' : 'failed'}`} key={`${row.id}-${recipient}`}>
                            {recipient}: {match?.success ? 'SMS ok' : match?.error || 'No delivery'}
                          </span>
                        )
                      })}
                    </div>

                    {row.callback ? (
                      <div className={`callback-line ${row.callback.outcome === 'connected' ? 'connected' : row.callback.outcome === 'missed' ? 'missed' : ''}`}>
                        <strong>Callback:</strong>
                        <span>{callbackStatus(row)}</span>
                        {row.callback.calls.length ? (
                          <span>{row.callback.calls.map((call) => `${call.agentName || 'Agent'} ${call.started ? 'rang' : 'failed'}`).join(' | ')}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <aside className="row-side">
                    {row.leadUrl ? <Link href={row.leadUrl}>Open lead</Link> : <span>No lead linked</span>}
                    <div className="side-block">
                      <span>Alert copy</span>
                      <p>{row.description || 'No alert text recorded.'}</p>
                    </div>
                    <div className="side-block muted">
                      <span>System source</span>
                      <p>{[row.source, row.trigger, row.trafficSource].filter(Boolean).join(' / ') || 'Not recorded'}</p>
                    </div>
                  </aside>
                </article>
              ))
            )}
          </section>
        </div>
      </main>
    </>
  )
}

const LEAD_ALERT_STYLES = `
.lead-alerts {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(227,46,46,.15), transparent 34rem),
    linear-gradient(180deg, #050505 0%, #101010 52%, #070707 100%);
  color: #f5f5f5;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
.lead-alerts * { box-sizing: border-box; }
.lead-alerts button { font-family: var(--font-sans); }
.alert-wrap { max-width: 1500px; margin: 0 auto; padding: 32px clamp(18px,4vw,48px) 80px; }
.alert-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
.alert-header h1 { margin: 8px 0 8px; font-size: clamp(32px,4vw,58px); line-height: .95; letter-spacing: 0; font-weight: 900; }
.alert-header p { margin: 0; color: #a3a3a3; font-size: 15px; line-height: 1.5; }
.back-link { color: #ffb4b4; font-size: 12px; font-weight: 850; letter-spacing: 0; text-decoration: none; text-transform: uppercase; }
.back-link:hover { color: #fff; }
.refresh-button,
.segmented button { border: 1px solid rgba(255,255,255,.12); color: #f8fafc; background: rgba(255,255,255,.06); border-radius: 10px; cursor: pointer; font-weight: 800; transition: transform .14s ease, border-color .14s ease, background .14s ease; }
.refresh-button { min-height: 38px; padding: 0 16px; }
.refresh-button:hover,
.segmented button:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.24); background: rgba(255,255,255,.1); }
.refresh-button:disabled { cursor: wait; opacity: .65; transform: none; }
.alert-stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.alert-stat { min-height: 92px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.055); border-radius: 14px; padding: 18px; box-shadow: 0 20px 50px -30px #000; }
.alert-stat span { display: block; color: #a3a3a3; font-size: 11px; font-weight: 850; letter-spacing: 0; text-transform: uppercase; }
.alert-stat strong { display: block; margin-top: 10px; font-size: 30px; line-height: 1; font-weight: 900; letter-spacing: 0; }
.alert-stat.tone-green strong { color: #22c55e; }
.alert-stat.tone-red strong { color: #f87171; }
.alert-stat.tone-blue strong { color: #60a5fa; }
.alert-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 0 0 18px; }
.segmented { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.3); border-radius: 14px; }
.segmented.wide { flex: 1 1 520px; }
.segmented button { min-height: 32px; padding: 0 13px; font-size: 12px; color: #a3a3a3; }
.segmented button.active { color: #fff; border-color: rgba(227,46,46,.65); background: rgba(227,46,46,.18); box-shadow: inset 0 0 0 1px rgba(227,46,46,.12); }
.alert-error { margin-bottom: 14px; border: 1px solid rgba(239,68,68,.36); background: rgba(239,68,68,.12); color: #fecaca; border-radius: 12px; padding: 13px 15px; font-size: 13px; font-weight: 750; }
.alert-list { display: grid; gap: 14px; }
.alert-empty { min-height: 180px; display: grid; place-items: center; border: 1px dashed rgba(255,255,255,.16); border-radius: 16px; color: #a3a3a3; background: rgba(255,255,255,.035); font-weight: 800; }
.alert-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, .35fr); gap: 18px; border: 1px solid rgba(255,255,255,.11); background: rgba(18,18,18,.88); border-radius: 16px; padding: 18px; box-shadow: 0 22px 60px -34px #000; }
.alert-row.has-failure { border-color: rgba(248,113,113,.32); }
.row-main { min-width: 0; display: grid; gap: 14px; }
.row-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.row-title h2 { margin: 0 0 6px; font-size: 22px; line-height: 1.1; font-weight: 900; letter-spacing: 0; }
.row-title p { margin: 0; color: #a3a3a3; font-size: 13px; line-height: 1.45; }
.row-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.channel-pill,
.source-pill { display: inline-flex; min-height: 28px; align-items: center; border-radius: 999px; border: 1px solid rgba(255,255,255,.13); padding: 0 10px; font-size: 11px; font-weight: 900; white-space: nowrap; }
.channel-pill { color: #fff; background: rgba(255,255,255,.08); }
.channel-form { color: #bbf7d0; background: rgba(34,197,94,.12); border-color: rgba(34,197,94,.28); }
.channel-call { color: #bfdbfe; background: rgba(96,165,250,.13); border-color: rgba(96,165,250,.3); }
.channel-sms { color: #fde68a; background: rgba(251,191,36,.12); border-color: rgba(251,191,36,.3); }
.source-pill { color: #fecaca; background: rgba(227,46,46,.13); border-color: rgba(227,46,46,.32); }
.alert-meta { display: flex; flex-wrap: wrap; gap: 8px; color: #a3a3a3; font-size: 12px; }
.alert-meta span { min-height: 26px; display: inline-flex; align-items: center; border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.035); border-radius: 999px; padding: 0 9px; }
.recipient-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.recipient-pill { display: inline-flex; min-height: 30px; align-items: center; border-radius: 999px; padding: 0 11px; font-size: 12px; font-weight: 850; border: 1px solid rgba(255,255,255,.12); }
.recipient-pill.sent { color: #bbf7d0; background: rgba(34,197,94,.1); border-color: rgba(34,197,94,.28); }
.recipient-pill.failed { color: #fecaca; background: rgba(239,68,68,.12); border-color: rgba(239,68,68,.35); }
.callback-line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); border-radius: 12px; padding: 11px 12px; color: #cbd5e1; font-size: 13px; line-height: 1.4; }
.callback-line strong { color: #fff; }
.callback-line.connected { border-color: rgba(34,197,94,.28); background: rgba(34,197,94,.08); }
.callback-line.missed { border-color: rgba(251,191,36,.28); background: rgba(251,191,36,.08); }
.row-side { min-width: 0; display: grid; align-content: start; gap: 12px; border-left: 1px solid rgba(255,255,255,.08); padding-left: 18px; }
.row-side a,
.row-side > span { color: #fca5a5; font-size: 12px; font-weight: 900; text-decoration: none; }
.row-side a:hover { color: #fff; }
.side-block { border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.035); border-radius: 12px; padding: 12px; }
.side-block span { color: #e5e5e5; font-size: 11px; font-weight: 900; letter-spacing: 0; text-transform: uppercase; }
.side-block p { margin: 8px 0 0; color: #b8b8b8; font-size: 12.5px; line-height: 1.55; overflow-wrap: anywhere; }
.side-block.muted p { color: #8a8a8a; }
@media (max-width: 1100px) {
  .alert-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .alert-row { grid-template-columns: 1fr; }
  .row-side { border-left: 0; border-top: 1px solid rgba(255,255,255,.08); padding: 14px 0 0; }
}
@media (max-width: 720px) {
  .alert-wrap { padding-inline: 14px; }
  .alert-header { display: grid; }
  .alert-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .row-title { display: grid; }
  .row-badges { justify-content: flex-start; }
  .segmented.wide { overflow-x: auto; flex-wrap: nowrap; }
}
`
