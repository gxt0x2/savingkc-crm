'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatPhone, toProperCase } from '@/lib/format'
import { DialerCallerPlan, normalizeDialerCallerPlan } from '@/lib/dialer-caller-plan'
import { CallingQueueReadiness } from '@/components/dialer/calling-queue-readiness'
import {
  dispositionStopsNumber,
  isReachedDisposition,
  dispositionLabel as canonicalDispositionLabel,
} from '@/lib/dialer-dispositions'

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
  is_verified_contact?: boolean
  verified_at?: string | null
  verified_by?: string | null
}

export interface Heir {
  key: string
  contact_name: string
  relationship: string
  address: string | null
  unattempted_count: number
  phones: HeirPhone[]
}

export interface HeirDialerSettings {
  callerId?: string | null
  agent?: string | null
  mode?: 'power' | 'predictive' | string | null
  pacing?: number | null
}

interface HeirsSectionProps {
  leadId: string
  deceasedOwnerName: string
  propertyAddress: string
  defaultExpanded?: boolean
  collapsible?: boolean
  dialerCallerId?: string | null
  dialerCallerPlan?: Partial<DialerCallerPlan> | null
  callHammerEnabled?: boolean
  autoStart?: boolean
  onAutoStartHandled?: () => void
  onAutoStartEmpty?: () => void
  /** When provided, a chat-bubble button appears next to each phone and calls this with the heir phone context. */
  onSmsPhone?: (args: { heirName: string; relation: string; phone: string; prospectPhoneId: string; deceasedOwnerName: string }) => void
  /** Rings to allow before giving up; flows to the Twilio Dial timeout. */
  ringCount?: number | null
  dialerSessionId?: string | null
}

function dispatchHeirQueue(
  queue: HeirDialerQueueItem[],
  callerId?: string | null,
  callerPlan?: Partial<DialerCallerPlan> | null,
  options?: { autoDial?: boolean; ringCount?: number | null },
  sessionId?: string | null,
) {
  if (queue.length === 0) return
  const detail: { queue: HeirDialerQueueItem[]; callerId?: string; callerPlan?: DialerCallerPlan; autoDial?: boolean; ringCount?: number; sessionId?: string } = { queue }
  if (typeof callerId === 'string' && callerId.trim()) detail.callerId = callerId.trim()
  const normalizedPlan = normalizeDialerCallerPlan(callerPlan, typeof callerId === 'string' ? callerId.trim() : '')
  detail.callerPlan = normalizedPlan
  if (options?.autoDial) detail.autoDial = true
  if (options?.ringCount && options.ringCount > 0) detail.ringCount = options.ringCount
  if (sessionId) detail.sessionId = sessionId
  window.dispatchEvent(new CustomEvent('open-dialer-queue', { detail }))
}

function phoneIcon(type: string | null): string {
  const t = (type ?? '').toLowerCase()
  if (t.includes('mobile') || t.includes('cell') || t.includes('wireless')) return 'smartphone'
  if (t.includes('voip')) return 'settings_phone'
  return 'phone'
}

// A phone is "verified" when we know it really belongs to this heir. That's
// true when the agent explicitly verified it (is_verified_contact, persisted
// server-side and manually toggleable) OR when the last disposition means they
// actually reached the person (reached === true in the shared taxonomy). The
// disposition fallback keeps historical calls — logged before the verified
// column existed — showing the green signal.
function isVerifiedPhone(p: HeirPhone): boolean {
  return Boolean(p.is_verified_contact) || isReachedDisposition(p.last_disposition)
}

function verifiedPhoneOf(heir: Heir): HeirPhone | null {
  return heir.phones.find(isVerifiedPhone) ?? null
}

function isAutoCallablePhone(p: HeirPhone): boolean {
  return Boolean(p.number?.trim())
    && p.connected?.toLowerCase() !== 'disconnected'
    && !dispositionStopsNumber(p.last_disposition)
}

function dispositionLabel(d: string | null): string {
  return canonicalDispositionLabel(d)
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
  defaultExpanded = false,
  collapsible = true,
  dialerCallerId = null,
  dialerCallerPlan = null,
  autoStart = false,
  onAutoStartHandled,
  onAutoStartEmpty,
  onSmsPhone,
  ringCount = null,
  dialerSessionId = null,
}: HeirsSectionProps) {
  const [heirs, setHeirs] = useState<Heir[]>([])
  const [loading, setLoading] = useState(true)
  const [lastTracedAt, setLastTracedAt] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const autoStartedLeadRef = useRef<string | null>(null)

  // Currently-dialing prospect_phone_id — populated from the telephony bar's
  // heir-queue-state event. The matching heir row auto-expands; the rest stay
  // collapsed until the user clicks one.
  const [activePhoneId, setActivePhoneId] = useState<string | null>(null)
  useEffect(() => {
    function onState(e: Event) {
      const detail = (e as CustomEvent).detail as { queueItem?: { prospect_phone_id?: string } | null }
      setActivePhoneId(detail?.queueItem?.prospect_phone_id ?? null)
    }
    window.addEventListener('heir-queue-state', onState)
    return () => window.removeEventListener('heir-queue-state', onState)
  }, [])

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

  const callablePhonesForHeir = useCallback((heir: Heir) => {
    const fresh = heir.phones.filter((phone) => isAutoCallablePhone(phone) && !phone.attempted)
    const tried = heir.phones.filter((phone) => isAutoCallablePhone(phone) && phone.attempted)
    return [...fresh, ...tried]
  }, [])

  const totalHeirs = heirs.length
  const totalPhones = heirs.reduce((n, h) => n + h.phones.length, 0)
  const unattemptedPhones = heirs.reduce(
    (n, h) => n + h.phones.filter((phone) => isAutoCallablePhone(phone) && !phone.attempted).length,
    0,
  )
  const queuedPhones = heirs.reduce((count, heir) => count + callablePhonesForHeir(heir).length, 0)
  const verifiedHeirs = heirs.filter((h) => verifiedPhoneOf(h)).length

  // Manual verify / unverify of a single number. Persists server-side and
  // reloads so the green signal + queue eligibility stay in sync.
  const toggleVerify = useCallback(async (phone: HeirPhone, nextVerified: boolean) => {
    try {
      const res = await fetch('/api/heirs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_phone_id: phone.id, verified: nextVerified, lead_id: leadId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || 'Could not update verification')
      }
      window.dispatchEvent(new CustomEvent('heir-attempt-logged', { detail: { leadId } }))
      await load()
      if (data?.warning) setError(data.warning)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update verification')
    }
  }, [leadId, load])

  const mapHeirPhones = useCallback((h: Heir, phones: HeirPhone[]): HeirDialerQueueItem[] => {
    return phones.map((p) => ({
      prospect_phone_id: p.id,
      phone: p.number,
      heirName: toProperCase(h.contact_name),
      relation: h.relationship,
      leadId,
      propertyAddress,
      deceasedOwnerName,
    }))
  }, [deceasedOwnerName, leadId, propertyAddress])

  // AUTO / BULK path (Call heirs, auto-start). Queue every callable listed
  // number for this property, grouped by heir. Attempted/verified phones stay
  // in the rotation for the current session; only hard-stop outcomes are
  // removed from auto dialing.
  const buildQueueForHeir = useCallback((h: Heir): HeirDialerQueueItem[] => {
    return mapHeirPhones(h, callablePhonesForHeir(h))
  }, [callablePhonesForHeir, mapHeirPhones])

  function queueAll() {
    const queue: HeirDialerQueueItem[] = heirs.flatMap((heir) => buildQueueForHeir(heir))
    dispatchHeirQueue(queue, dialerCallerId, dialerCallerPlan, { ringCount }, dialerSessionId)
  }

  // Explicit recalls may include attempted/verified numbers, but hard-stop
  // outcomes are never reintroduced into a dial queue.
  function queueHeir(heir: Heir) {
    dispatchHeirQueue(mapHeirPhones(heir, callablePhonesForHeir(heir)), dialerCallerId, dialerCallerPlan, { ringCount }, dialerSessionId)
  }

  function queueOne(heir: Heir, phone: HeirPhone) {
    if (!isAutoCallablePhone(phone)) {
      setError(`${formatPhone(phone.number) || phone.number} is blocked by its saved call outcome.`)
      return
    }
    const clicked = mapHeirPhones(heir, [phone])[0]
    const remaining = heirs
      .flatMap((h) => buildQueueForHeir(h))
      .filter((item) => item.prospect_phone_id !== phone.id)
    dispatchHeirQueue([clicked, ...remaining], dialerCallerId, dialerCallerPlan, { ringCount }, dialerSessionId)
  }

  useEffect(() => {
    if (!autoStart || loading) return
    // If the heirs failed to load, hold on this record — surface the error and
    // let the agent retry rather than silently auto-advancing to the next
    // deceased owner without calling anyone.
    if (error) return
    if (autoStartedLeadRef.current === leadId) return
    autoStartedLeadRef.current = leadId

    const queue: HeirDialerQueueItem[] = heirs.flatMap((heir) => buildQueueForHeir(heir))

    if (queue.length > 0) {
      dispatchHeirQueue(queue, dialerCallerId, dialerCallerPlan, { autoDial: true, ringCount }, dialerSessionId)
      onAutoStartHandled?.()
      return
    }
    onAutoStartEmpty?.()
  }, [autoStart, buildQueueForHeir, dialerCallerId, dialerCallerPlan, dialerSessionId, error, heirs, leadId, loading, onAutoStartEmpty, onAutoStartHandled, ringCount])

  return (
    <section className={`ck-card overflow-hidden ${expanded ? (collapsible ? 'p-6' : 'p-0') : 'px-6 py-4'}`}>
      {/* Header — click anywhere (except Call button) to toggle when collapsible */}
      <header
        className={`flex items-center justify-between gap-4 ${expanded && collapsible ? 'mb-5' : ''} ${collapsible ? 'cursor-pointer select-none' : 'border-b border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-5 py-4 sm:px-6'}`}
        onClick={collapsible ? () => setExpanded((v) => !v) : undefined}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon name="diversity_3" className="!text-xl text-[var(--ck-text-muted)] shrink-0" />
          <h2 className="text-sm font-black uppercase tracking-widest text-[var(--ck-text)]">
            {collapsible ? 'Heirs' : 'Callable people'}
            {totalHeirs > 0 && (
              <span className="ml-2 text-[var(--ck-text-dim)] font-bold">
                ({totalHeirs} · {totalPhones} {totalPhones === 1 ? 'phone' : 'phones'})
              </span>
            )}
          </h2>
          {lastTracedAt && (
            <span className="text-[10px] text-[var(--ck-text-dim)] whitespace-nowrap hidden sm:inline">
              Traced {daysAgo(lastTracedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalHeirs > 0 && queuedPhones > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); queueAll() }}
              className="bg-[#E32E2E] hover:bg-[#C42626] text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide flex items-center gap-2 shadow-sm transition-colors whitespace-nowrap"
              title="Cycle through every callable listed heir phone on this lead"
            >
              <Icon name="call" size="text-sm" />
              Call heirs ({queuedPhones})
            </button>
          )}
          {collapsible && (
            <Icon
              name={expanded ? 'expand_less' : 'expand_more'}
              className="!text-xl text-[var(--ck-text-muted)]"
            />
          )}
        </div>
      </header>

      {!expanded && null}
      {expanded && <div className={`heirs-body-wrap ${collapsible ? '' : 'p-5 sm:p-6'}`}>
      {/* --- expanded body starts --- */}

      {!collapsible && !loading && totalHeirs > 0 ? (
        <CallingQueueReadiness people={totalHeirs} ready={queuedPhones} verified={verifiedHeirs} />
      ) : null}

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
              isActive={Boolean(activePhoneId && heir.phones.some((p) => p.id === activePhoneId))}
              onCallPhone={(phone) => queueOne(heir, phone)}
              onCallHeir={() => queueHeir(heir)}
              onToggleVerify={toggleVerify}
              onSmsPhone={onSmsPhone ? (phone) => onSmsPhone({
                heirName: toProperCase(heir.contact_name),
                relation: heir.relationship,
                phone: phone.number,
                prospectPhoneId: phone.id,
                deceasedOwnerName,
              }) : undefined}
            />
          ))}
        </div>
      )}

      {/* Re-sync footer when heirs exist (muted, secondary action) */}
      {!loading && totalHeirs > 0 && (
        <div className="mt-5 pt-4 border-t border-[var(--ck-border)] flex items-center justify-between">
          <p className="text-[10px] text-[var(--ck-text-dim)]">
            {unattemptedPhones === 0
              ? verifiedHeirs > 0
                ? `${verifiedHeirs} of ${totalHeirs} heir${totalHeirs === 1 ? '' : 's'} verified. Re-sync if new data is expected.`
                : 'All heir phones attempted. Re-sync if new data is expected.'
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
      {/* --- expanded body ends --- */}
      </div>}
    </section>
  )
}

function HeirRow({
  heir,
  alt,
  isActive,
  onCallPhone,
  onCallHeir,
  onToggleVerify,
  onSmsPhone,
}: {
  heir: Heir
  alt: boolean
  isActive: boolean
  onCallPhone: (phone: HeirPhone) => void
  onCallHeir: () => void
  onToggleVerify: (phone: HeirPhone, nextVerified: boolean) => void
  onSmsPhone?: (phone: HeirPhone) => void
}) {
  const verified = verifiedPhoneOf(heir)
  const allAttempted = heir.unattempted_count === 0 && heir.phones.length > 0
  const callablePhones = heir.phones.filter(isAutoCallablePhone)
  const freshCallableCount = callablePhones.filter((phone) => !phone.attempted).length

  // Show every number — recall is never hidden. The verified line (if any)
  // floats to the top and is styled green; the rest stay callable underneath.
  const visiblePhones = verified
    ? [verified, ...heir.phones.filter((p) => p.id !== verified.id)]
    : heir.phones

  // Auto-expand the heir currently being called. Otherwise collapse — Ernest
  // only wants one heir's details in view at a time. User can manually
  // override by clicking the row header; that override resets whenever the
  // active heir changes so attention follows the live call.
  const [userToggled, setUserToggled] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setUserToggled(false))
    return () => cancelAnimationFrame(id)
  }, [isActive])
  const expanded = isActive ? !userToggled : userToggled

  const statusDotColor = isActive
    ? 'bg-emerald-400 animate-pulse'
    : verified
    ? 'bg-emerald-400'
    : heir.phones.length === 0
    ? 'bg-[var(--ck-text-dim)]'
    : allAttempted
    ? 'bg-amber-400'
    : 'bg-[#E32E2E]'

  const rowBg = alt ? 'bg-[var(--ck-surface-elev)]' : 'bg-[var(--ck-surface)]'

  return (
    <div
      className={`${rowBg} border ${
        isActive
          ? 'border-emerald-500/60 ring-1 ring-emerald-500/20'
          : verified
          ? 'border-emerald-500/40'
          : 'border-[var(--ck-border)]'
      } rounded-xl ${expanded ? 'p-4' : 'px-4 py-2.5'} hover:border-[var(--ck-border-strong)] transition-colors`}
    >
      {/* Name row — clickable to expand/collapse, per-heir Call in the corner */}
      <div
        className={`flex items-center justify-between gap-3 ${expanded ? 'mb-2' : ''} cursor-pointer select-none`}
        onClick={() => setUserToggled((v) => !v)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor}`} aria-hidden />
          <span className="text-sm font-bold text-[var(--ck-text)] truncate">
            {toProperCase(heir.contact_name)}
          </span>
          <span className="text-[11px] text-[var(--ck-text-muted)] capitalize whitespace-nowrap">
            · {heir.relationship}
          </span>
        </div>

        {/* Attempted and verified numbers remain recallable. Hard-stop outcomes
            are visible for history but never return to a dial queue. */}
        <div className="flex items-center gap-2 shrink-0">
          {verified && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 whitespace-nowrap flex items-center gap-1">
              <Icon name="verified" size="text-sm" filled /> Verified
            </span>
          )}
          {callablePhones.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onCallHeir() }}
              className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shadow-sm transition-colors text-white ${
                freshCallableCount > 0
                  ? 'bg-[#E32E2E] hover:bg-[#C42626]'
                  : 'bg-[var(--ck-surface-hi)] hover:bg-[var(--ck-border-strong)] text-[var(--ck-text)]'
              }`}
              title={
                freshCallableCount > 0
                  ? `Queue ${callablePhones.length} callable ${callablePhones.length === 1 ? 'phone' : 'phones'} for this heir`
                  : 'Call this heir again using callable numbers'
              }
            >
              <Icon name={freshCallableCount > 0 ? 'call' : 'restart_alt'} size="text-xs" />
              {freshCallableCount > 0 ? `Call (${callablePhones.length})` : 'Call again'}
            </button>
          )}
          <Icon
            name={expanded ? 'expand_less' : 'expand_more'}
            className="!text-lg text-[var(--ck-text-dim)]"
          />
        </div>
      </div>

      {/* Collapsible body — only rendered when expanded */}
      {expanded && <>
      {/* Heir address row — only when present */}
      {heir.address && (
        <div className="flex items-center gap-2 mb-3 pl-4">
          <Icon name="location_on" size="text-xs" className="text-[var(--ck-text-dim)] shrink-0" />
          <span className="text-[11px] text-[var(--ck-text-muted)] truncate">{heir.address}</span>
        </div>
      )}

      {/* Phone pills */}
      <div className="space-y-1.5">
        {heir.phones.length === 0 && (
          <p className="text-[11px] text-[var(--ck-text-dim)] italic">No phones on file.</p>
        )}
        {visiblePhones.map((phone) => (
          <PhonePill
            key={phone.id}
            phone={phone}
            verified={isVerifiedPhone(phone)}
            onCall={() => onCallPhone(phone)}
            onToggleVerify={(next) => onToggleVerify(phone, next)}
            onSms={onSmsPhone ? () => onSmsPhone(phone) : undefined}
          />
        ))}
      </div>
      </>}
    </div>
  )
}

function PhonePill({
  phone,
  verified,
  onCall,
  onToggleVerify,
  onSms,
}: {
  phone: HeirPhone
  verified: boolean
  onCall: () => void
  onToggleVerify: (nextVerified: boolean) => void
  onSms?: () => void
}) {
  const icon = phoneIcon(phone.type)
  const typeLabel = (phone.type ?? 'phone').toLowerCase()
  const callable = isAutoCallablePhone(phone)

  return (
    <div
      className={`flex items-center gap-3 py-1.5 pr-1.5 pl-2 rounded-lg transition-colors group ${
        verified ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30' : 'hover:bg-[var(--ck-surface-hi)]'
      }`}
    >
      {verified ? (
        <Icon name="verified" size="text-base" className="text-emerald-400" filled />
      ) : (
        <Icon
          name={icon}
          size="text-sm"
          className={phone.attempted ? 'text-[var(--ck-text-dim)]' : 'text-[var(--ck-text)]'}
        />
      )}
      <span
        className={`font-mono text-sm tabular-nums ${
          verified
            ? 'text-emerald-300 font-bold'
            : phone.attempted
            ? 'text-[var(--ck-text-muted)]'
            : 'text-[var(--ck-text)] font-bold'
        }`}
      >
        {formatPhone(phone.number) || phone.number}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-[var(--ck-text-dim)]">
        {typeLabel}
      </span>

      {phone.attempted && (
        <span
          className={`text-[11px] truncate flex items-center gap-1.5 ml-1 ${
            verified ? 'text-emerald-300 font-bold' : 'text-[var(--ck-text-muted)]'
          }`}
        >
          {dispositionLabel(phone.last_disposition)}
          {phone.last_attempt_at && (
            <span className={verified ? 'text-emerald-400/70' : 'text-[var(--ck-text-dim)]'}>
              · {daysAgo(phone.last_attempt_at)}
            </span>
          )}
        </span>
      )}

      <div className="flex-1" />

      {/* Verify / unverify toggle — manual override of the green signal. */}
      <button
        onClick={() => onToggleVerify(!verified)}
        className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors border ${
          verified
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
            : 'bg-[var(--ck-surface-elev)] border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
        }`}
        title={verified ? 'Verified as this heir — click to unverify' : 'Mark this as the verified number for this heir'}
        aria-label={verified ? 'Unverify this number' : 'Verify this number'}
        aria-pressed={verified}
      >
        <Icon name={verified ? 'verified' : 'verified_user'} size="text-sm" filled={verified} />
      </button>

      {onSms && (
        <button
          onClick={onSms}
          className="shrink-0 w-8 h-8 rounded-lg bg-[var(--ck-surface-elev)] hover:bg-[var(--ck-surface-hi)] border border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] flex items-center justify-center transition-colors"
          title="Send SMS to this number"
          aria-label="Send SMS"
        >
          <Icon name="chat" size="text-sm" />
        </button>
      )}
      <button
        onClick={onCall}
        disabled={!callable}
        className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors text-white disabled:cursor-not-allowed disabled:bg-[var(--ck-surface-hi)] disabled:text-[var(--ck-text-dim)] ${
          !callable
            ? ''
            : verified
            ? 'bg-emerald-500 hover:bg-emerald-600'
            : 'bg-[#E32E2E] hover:bg-[#C42626]'
        }`}
        title={
          !callable
            ? 'Calling blocked by saved disposition'
            : verified
            ? 'Redial the verified number'
            : phone.attempted
            ? 'Call this number again'
            : 'Call this number'
        }
        aria-label={callable ? 'Call this number' : 'Calling blocked for this number'}
      >
        <Icon name={phone.attempted ? 'restart_alt' : 'call'} size="text-sm" />
      </button>
    </div>
  )
}
