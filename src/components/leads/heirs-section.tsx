'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatPhone, toProperCase } from '@/lib/format'

// Dialer queue item — sent to DialerPanel so it can cycle through heirs while
// the property stays pinned. `leadId` is the property's lead_id, never the
// relative's.
export interface HeirDialerQueueItem {
  prospect_phone_id: string
  phone: string
  heirName: string
  relation: string
  leadId: string
  propertyAddress: string
  deceasedOwnerName: string
}

export interface HeirPhone {
  id: string
  number: string
  type: string | null
  connected: string | null
  attempted: boolean
  last_disposition: string | null
  last_attempt_at: string | null
}

export interface Heir {
  key: string
  contact_name: string
  relationship: string
  unattempted_count: number
  phones: HeirPhone[]
}

interface HeirsSectionProps {
  leadId: string
  deceasedOwnerName: string
  propertyAddress: string
}

function dispatchHeirQueue(queue: HeirDialerQueueItem[]) {
  if (queue.length === 0) return
  window.dispatchEvent(new CustomEvent('open-dialer-queue', { detail: { queue } }))
}

function phoneIcon(type: string | null): string {
  const t = (type ?? '').toLowerCase()
  if (t.includes('mobile') || t.includes('cell') || t.includes('wireless')) return 'smartphone'
  if (t.includes('voip')) return 'settings_phone'
  return 'phone'
}

function dispositionLabel(d: string | null): string {
  if (!d) return ''
  return d.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function daysAgo(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

export function HeirsSection({
  leadId,
  deceasedOwnerName,
  propertyAddress,
}: HeirsSectionProps) {
  const [heirs, setHeirs] = useState<Heir[]>([])
  const [loading, setLoading] = useState(true)
  const [lastTracedAt, setLastTracedAt] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/heirs?lead_id=${encodeURIComponent(leadId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load heirs')
      setHeirs(data.heirs || [])
      setLastTracedAt(data.last_skip_traced_at || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load heirs')
    } finally {
      setLoading(false)
    }
  }, [leadId])

  useEffect(() => { load() }, [load])

  // Reload when the dialer reports an attempt was logged for this lead.
  useEffect(() => {
    function onAttempt(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail || detail.leadId === leadId) load()
    }
    window.addEventListener('heir-attempt-logged', onAttempt)
    return () => window.removeEventListener('heir-attempt-logged', onAttempt)
  }, [leadId, load])

  async function runSync() {
    setIsSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/heirs/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.hint ? `${data.error} — ${data.hint}` : data.error || 'Sync failed')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  const totalHeirs = heirs.length
  const totalPhones = heirs.reduce((n, h) => n + h.phones.length, 0)
  const unattemptedPhones = heirs.reduce((n, h) => n + h.unattempted_count, 0)

  function queueAll() {
    const queue: HeirDialerQueueItem[] = []
    heirs.forEach((h) => {
      h.phones
        .filter((p) => !p.attempted)
        .forEach((p) => {
          queue.push({
            prospect_phone_id: p.id,
            phone: p.number,
            heirName: toProperCase(h.contact_name),
            relation: h.relationship,
            leadId,
            propertyAddress,
            deceasedOwnerName,
          })
        })
    })
    dispatchHeirQueue(queue)
  }

  function queueOne(heir: Heir, phone: HeirPhone) {
    dispatchHeirQueue([{
      prospect_phone_id: phone.id,
      phone: phone.number,
      heirName: toProperCase(heir.contact_name),
      relation: heir.relationship,
      leadId,
      propertyAddress,
      deceasedOwnerName,
    }])
  }

  return (
    <section className="ck-card p-6">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <Icon name="diversity_3" className="!text-xl text-[var(--ck-text-muted)] shrink-0" />
          <h2 className="text-sm font-black uppercase tracking-widest text-[var(--ck-text)]">
            Heirs
            {totalHeirs > 0 && (
              <span className="ml-2 text-[var(--ck-text-dim)] font-bold">
                ({totalHeirs} · {totalPhones} {totalPhones === 1 ? 'phone' : 'phones'})
              </span>
            )}
          </h2>
          {lastTracedAt && (
            <span className="text-[10px] text-[var(--ck-text-dim)] whitespace-nowrap">
              Traced {daysAgo(lastTracedAt)}
            </span>
          )}
        </div>
        {totalHeirs > 0 && unattemptedPhones > 0 && (
          <button
            onClick={queueAll}
            className="bg-[#E32E2E] hover:bg-[#C42626] text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide flex items-center gap-2 shadow-sm transition-colors whitespace-nowrap"
            title="Cycle through all unattempted heir phones"
          >
            <Icon name="call" size="text-sm" />
            Call heirs ({unattemptedPhones})
          </button>
        )}
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-[#E32E2E]/10 border border-[#E32E2E]/30 text-xs text-[#E32E2E]">
          <Icon name="error_outline" size="text-sm" className="inline mr-1 align-[-2px]" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="py-10 text-center">
          <Icon name="progress_activity" className="!text-3xl text-[var(--ck-text-dim)] animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && totalHeirs === 0 && (
        <div className="text-center py-10">
          <Icon name="person_search" className="!text-5xl text-[var(--ck-text-dim)] mb-3" />
          <p className="text-sm font-bold text-[var(--ck-text)] mb-1">No heirs on file yet</p>
          <p className="text-xs text-[var(--ck-text-muted)] mb-5 max-w-sm mx-auto leading-relaxed">
            Run skip trace on the deceased owner to find living relatives and their phone numbers.
          </p>
          <button
            onClick={runSync}
            disabled={isSyncing}
            className="bg-[#E32E2E] hover:bg-[#C42626] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-black uppercase tracking-wide inline-flex items-center gap-2 shadow-sm transition-colors"
          >
            <Icon name={isSyncing ? 'progress_activity' : 'person_search'} size="text-base" className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Running skip trace…' : 'Run skip trace'}
          </button>
        </div>
      )}

      {/* Populated — alternating rows */}
      {!loading && totalHeirs > 0 && (
        <div className="space-y-2">
          {heirs.map((heir, idx) => (
            <HeirRow
              key={heir.key}
              heir={heir}
              alt={idx % 2 === 1}
              onCallPhone={(phone) => queueOne(heir, phone)}
            />
          ))}
        </div>
      )}

      {/* Re-sync footer when heirs exist (muted, secondary action) */}
      {!loading && totalHeirs > 0 && (
        <div className="mt-5 pt-4 border-t border-[var(--ck-border)] flex items-center justify-between">
          <p className="text-[10px] text-[var(--ck-text-dim)]">
            {unattemptedPhones === 0
              ? 'All heir phones attempted. Re-sync if new data is expected.'
              : `${unattemptedPhones} unattempted · auto-advances through queue.`}
          </p>
          <button
            onClick={runSync}
            disabled={isSyncing}
            className="text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
          >
            <Icon name={isSyncing ? 'progress_activity' : 'refresh'} size="text-xs" className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Re-syncing…' : 'Re-sync'}
          </button>
        </div>
      )}
    </section>
  )
}

function HeirRow({
  heir,
  alt,
  onCallPhone,
}: {
  heir: Heir
  alt: boolean
  onCallPhone: (phone: HeirPhone) => void
}) {
  const allAttempted = heir.unattempted_count === 0 && heir.phones.length > 0
  const statusDotColor = heir.phones.length === 0
    ? 'bg-[var(--ck-text-dim)]'
    : allAttempted
    ? 'bg-emerald-400'
    : 'bg-[#E32E2E]'

  const rowBg = alt ? 'bg-[var(--ck-surface-elev)]' : 'bg-[var(--ck-surface)]'

  return (
    <div
      className={`${rowBg} border border-[var(--ck-border)] rounded-xl p-4 hover:border-[var(--ck-border-strong)] transition-colors`}
    >
      {/* Name row */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor}`} aria-hidden />
          <span className="text-sm font-bold text-[var(--ck-text)] truncate">
            {toProperCase(heir.contact_name)}
          </span>
          <span className="text-[11px] text-[var(--ck-text-muted)] capitalize whitespace-nowrap">
            · {heir.relationship}
          </span>
        </div>
        {allAttempted && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 whitespace-nowrap flex items-center gap-1">
            <Icon name="check_circle" size="text-xs" /> All tried
          </span>
        )}
      </div>

      {/* Phone pills */}
      <div className="space-y-1.5">
        {heir.phones.length === 0 && (
          <p className="text-[11px] text-[var(--ck-text-dim)] italic">No phones on file.</p>
        )}
        {heir.phones.map((phone) => (
          <PhonePill key={phone.id} phone={phone} onCall={() => onCallPhone(phone)} />
        ))}
      </div>
    </div>
  )
}

function PhonePill({ phone, onCall }: { phone: HeirPhone; onCall: () => void }) {
  const icon = phoneIcon(phone.type)
  const typeLabel = (phone.type ?? 'phone').toLowerCase()

  return (
    <div className="flex items-center gap-3 py-1.5 pr-1.5 pl-2 rounded-lg hover:bg-[var(--ck-surface-hi)] transition-colors group">
      <Icon
        name={icon}
        size="text-sm"
        className={phone.attempted ? 'text-[var(--ck-text-dim)]' : 'text-[var(--ck-text)]'}
      />
      <span
        className={`font-mono text-sm tabular-nums ${phone.attempted ? 'text-[var(--ck-text-muted)]' : 'text-[var(--ck-text)] font-bold'}`}
      >
        {formatPhone(phone.number) || phone.number}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-[var(--ck-text-dim)]">
        {typeLabel}
      </span>

      {phone.attempted && (
        <span className="text-[11px] text-[var(--ck-text-muted)] truncate flex items-center gap-1.5 ml-1">
          <Icon name="check_circle" size="text-xs" className="text-emerald-400" />
          {dispositionLabel(phone.last_disposition)}
          {phone.last_attempt_at && (
            <span className="text-[var(--ck-text-dim)]">· {daysAgo(phone.last_attempt_at)}</span>
          )}
        </span>
      )}

      <div className="flex-1" />

      <button
        onClick={onCall}
        disabled={phone.attempted}
        className="shrink-0 w-8 h-8 rounded-lg bg-[#E32E2E] hover:bg-[#C42626] disabled:bg-[var(--ck-border-strong)] disabled:text-[var(--ck-text-dim)] text-white flex items-center justify-center transition-colors"
        title={phone.attempted ? 'Already attempted — redial from dialer if needed' : 'Call this number'}
        aria-label="Call this number"
      >
        <Icon name="call" size="text-sm" />
      </button>
    </div>
  )
}
