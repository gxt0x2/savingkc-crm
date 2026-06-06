'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

type SignalDestination = {
  destination: string
  status: string
  detail: string
}

type SignalRow = {
  eventName: string
  label: string
  status: string
  optimizationRole: string | null
  eventTime: string | null
  sentAt: string | null
  attempts: number
  lastError: string | null
  clickIdType: string | null
  hasClickId: boolean
  hasUserIdentifiers: boolean
  destinations: SignalDestination[]
}

type AdsSignalReceiptData = {
  isPaidLead: boolean
  sourceLabel: string | null
  campaign: string | null
  identifierType: string | null
  hasIdentifier: boolean
  signals: SignalRow[]
  warnings: string[]
}

function formatTime(value: string | null): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function destinationLabel(value: string): string {
  if (value === 'google_ads') return 'Google'
  if (value === 'openai_ads') return 'OpenAI'
  if (value === 'stape') return 'Stape'
  return value.replace(/_/g, ' ')
}

function statusStyle(status: string): { icon: string; color: string; background: string; label: string } {
  if (status === 'sent') {
    return { icon: 'check_circle', color: 'var(--ck-success)', background: 'rgba(16,185,129,0.12)', label: 'Sent' }
  }
  if (status === 'pending' || status === 'processing') {
    return { icon: 'schedule', color: 'var(--ck-warn)', background: 'rgba(245,158,11,0.12)', label: 'Pending' }
  }
  if (status === 'failed') {
    return { icon: 'error', color: 'var(--ck-accent-bright)', background: 'rgba(239,68,68,0.12)', label: 'Failed' }
  }
  if (status === 'skipped') {
    return { icon: 'block', color: 'var(--ck-text-muted)', background: 'var(--ck-surface-elev)', label: 'Skipped' }
  }
  return { icon: 'radio_button_unchecked', color: 'var(--ck-text-dim)', background: 'var(--ck-surface-elev)', label: 'Not queued' }
}

function SignalItem({ signal }: { signal: SignalRow }) {
  const style = statusStyle(signal.status)
  return (
    <div
      className="min-w-0 rounded-xl border p-3"
      style={{ background: 'var(--ck-surface-elev)', borderColor: 'var(--ck-border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-black text-[color:var(--ck-text)]">{signal.label}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-[color:var(--ck-text-dim)]">
            {signal.optimizationRole ? `${signal.optimizationRole} · ` : ''}{formatTime(signal.sentAt || signal.eventTime)}
          </p>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider"
          style={{ background: style.background, color: style.color }}
        >
          <Icon name={style.icon} className="!text-[13px]" />
          {style.label}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {signal.destinations.length > 0 ? signal.destinations.map((destination) => {
          const ok = destination.status === 'sent'
          return (
            <span
              key={`${signal.eventName}:${destination.destination}`}
              className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
              style={{
                borderColor: ok ? 'rgba(16,185,129,0.35)' : 'var(--ck-border)',
                color: ok ? 'var(--ck-success)' : 'var(--ck-text-muted)',
              }}
              title={destination.detail || undefined}
            >
              {destinationLabel(destination.destination)}
            </span>
          )
        }) : (
          <span className="text-[11px] font-semibold text-[color:var(--ck-text-dim)]">
            Waiting for event
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider text-[color:var(--ck-text-dim)]">
        {signal.clickIdType && <span>{signal.clickIdType}</span>}
        {signal.hasUserIdentifiers && <span>hashed ids</span>}
        {signal.lastError && <span className="text-[color:var(--ck-accent-bright)]">error</span>}
      </div>
    </div>
  )
}

export function AdsSignalReceipt({ leadId }: { leadId: string }) {
  const [data, setData] = useState<AdsSignalReceiptData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leads/${leadId}/ppc-signals`, { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : null)
      .then((next) => {
        if (!cancelled) setData(next)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  if (!data || (!data.isPaidLead && data.warnings.length === 0)) return null

  return (
    <section
      className="mb-4 rounded-2xl border p-4"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="verified" className="!text-base !text-[color:var(--ck-accent)]" />
            <h2 className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">Ads Receipt</h2>
          </div>
          <p className="mt-1 text-sm font-semibold text-[color:var(--ck-text-muted)]">
            {[data.sourceLabel, data.campaign].filter(Boolean).join(' · ') || 'Paid-source tracking'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.identifierType && (
            <span
              className="rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider"
              style={{ borderColor: 'var(--ck-border)', color: data.hasIdentifier ? 'var(--ck-success)' : 'var(--ck-text-dim)' }}
            >
              {data.identifierType}{data.hasIdentifier ? ' stored' : ' missing'}
            </span>
          )}
        </div>
      </div>

      {data.warnings.length > 0 && (
        <div
          className="mb-3 rounded-xl border px-3 py-2 text-xs font-bold"
          style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.10)', color: 'var(--ck-warn)' }}
        >
          {data.warnings[0]}
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-3">
        {data.signals.map((signal) => <SignalItem key={signal.eventName} signal={signal} />)}
      </div>
    </section>
  )
}
